import { APIGatewayProxyEventV2, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyResultV2 } from 'aws-lambda';
import fetch from 'node-fetch';
import { Project, ProjectConfig, ProjectConfigs, Source, SourceConfig, SourceConfigs } from './static';

const CACHE_TTL: number = Number(process.env.CACHE_TTL) || 600;
const DEFAULT_RESPONSE_HEADERS = {
    'content-type': 'application/json',
    'access-control-allow-headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS'
};

export async function main(
    event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
    const { rawPath: path, queryStringParameters: queryParams } = event;

    // Try to fetch data from cache or source
    try {
        // Make sure given source is valid (check if path without leading slash is a source key)
        // Note: such an event ever reaching the Lambda function would indicate a misconfigured API gateway
        const sourceConfig = SourceConfigs[path.substring(1) as Source];
        if (!sourceConfig) {
            return buildErrorResponse(404, 'Invalid source provided');
        }

        // Make sure required query params have been provided
        if (sourceConfig.requiredParams.length > 0 && (!queryParams || !areRequiredQueryParamsPresent(sourceConfig.requiredParams, queryParams))) {
            return buildErrorResponse(422, 'Missing required query string parameter(s)');
        }

        // Sending a search player search with "where=e" (endswith) to BF2
        // always results in a timeout on their end, so block requests with "where=e"
        if (sourceConfig.endpoint == SourceConfigs.searchforplayers.endpoint && queryParams?.where?.toLowerCase() == 'e') {
            return buildErrorResponse(422, 'searchforplayers does not support "endswith"/"where=e" search');
        }

        // Determine BF2 "revive" project to request data from (defaulting to BF2Hub)
        const projectConfig = ProjectConfigs[queryParams?.project as Project] ?? ProjectConfigs.bf2hub;

        let requestParams: Record<string, string | undefined> = sourceConfig.defaultParams;
        // Add query params if any were given
        if (queryParams) {
            requestParams = {
                ...requestParams,
                ...queryParams
            };
        }
        let response: AspxResponse | GroupedGetPlayerInfoResponse = await fetchFromSource(
            projectConfig,
            sourceConfig,
            requestParams
        );

        // Group stats values for armies, classes, vehicles and weapons if requested
        if (sourceConfig.endpoint == SourceConfigs.getplayerinfo.endpoint && !!queryParams?.groupValues) {
            const playerInfo = response as GetPlayerInfoResponse;
            response = {
                ...playerInfo,
                grouped: {
                    armies: groupStatsByRegex<ArmyStats>(playerInfo.player, /^a(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                    classes: groupStatsByRegex<ClassStats>(playerInfo.player, /^k(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                    vehicles: groupStatsByRegex<VehicleStats>(playerInfo.player, /^v(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                    weapons: groupStatsByRegex<WeaponStats>(playerInfo.player, /^w(?<key>[a-zA-Z]+)-(?<index>\d+)$/),
                    maps: groupStatsByRegex<MapStats>(playerInfo.player, /^m(?<key>[a-zA-Z]+)-(?<index>\d+)$/)
                }
            };
        }

        return {
            statusCode: 200,
            headers: {
                ...DEFAULT_RESPONSE_HEADERS,
                'cache-control': `max-age=${CACHE_TTL}`
            },
            body: JSON.stringify(response, null, 2)
        };
    } catch (err: any) { // eslint-disable-line  @typescript-eslint/no-explicit-any
        let statusCode = 500;
        if (err.message === 'Player not found') {
            statusCode = 404;
        }
        else {
            console.log(err);
        }
        return buildErrorResponse(statusCode, String(err?.message));
    }
}

function buildErrorResponse(statusCode: number, message: string): APIGatewayProxyResultV2 {
    return {
        statusCode,
        headers: DEFAULT_RESPONSE_HEADERS,
        body: JSON.stringify({ errors: [message] }, null, 2)
    };
}

function areRequiredQueryParamsPresent(requiredParams: string[], givenParams: APIGatewayProxyEventQueryStringParameters): boolean {
    return requiredParams.every((key) => {
        const value = givenParams?.[key];
        return value && value.trim().length > 0;
    });
}

type GetPlayerInfoResponse = {
    asof: string
    player: Record<string, string>
}

type GroupedGetPlayerInfoResponse = GetPlayerInfoResponse & {
    grouped: {
        armies?: ArmyStats[]
        classes?: ClassStats[]
        vehicles?: VehicleStats[]
        weapons?: WeaponStats[]
        maps?: MapStats[]
    }
}
type ArmyStats = {
    id: number
    tm: string
    wn: string
    lo: string
    br: string
}
type ClassStats = {
    id: number
    tm: string
    kl: string
    dt: string
    kd: string
}
type VehicleStats = {
    id: number
    tm: string
    kl: string
    dt: string
    kd: string
    kr: string
}
type WeaponStats = {
    id: number
    tm: string
    kl: string
    dt: string
    ac: string
    kd: string
}
type MapStats = {
    id: number
    tm: string
    wn: string
    ls: string
}

type GetRankInfoResponse = {
    rank: string
    chng: string
    decr: string
}

type GetAwardsInfoResponse = {
    pid: string
    asof: string
    awards: {
        award: string
        level: string
        when: string
        first: string
    }
}

type GetUnlocksInfoResponse = {
    pid: string
    nick: string
    asof: string
    status: {
        enlisted: string
        officer: string
    }
    unlocks: {
        id: string
        state: string
    }
}

type GetLeaderboardResponse = {
    size: string
    asof: string
    players: {
        // Leaderboards contain different player attributes depending on the leaderboard, these are the only static ones
        n: string
        pid: string
        nick: string
    }[]
}

type SearchForPlayersResponse = {
    asof: string
    players: {
        n: string
        pid: string
        nick: string
        score: string
    }[]
}

type AspxResponse = GetPlayerInfoResponse | GetRankInfoResponse | GetAwardsInfoResponse  | GetUnlocksInfoResponse  | GetLeaderboardResponse | SearchForPlayersResponse

async function fetchFromSource(projectConfig: ProjectConfig, sourceConfig: SourceConfig, queryParams: Record<string, string | undefined>): Promise<AspxResponse> {
    const url = new URL(sourceConfig.endpoint, projectConfig.baseUrl);
    for (const key in queryParams) {
        const value = queryParams[key];
        if (value) {
            url.searchParams.append(key, value);
        }
    }

    const response = await fetch(url.toString(), {
        headers: projectConfig.defaultHeaders
    });

    // Parse BF2 data format
    const content = await response.text();
    return parseBf2Response(content, sourceConfig.propertyKeys, sourceConfig.forceReturnArray);
}

function parseBf2Response(rawResponse: string, propertyKeys: string[] | undefined, forceReturnArray = false): AspxResponse {
    // Split response into lines
    const lines = rawResponse.split('\n');

    // Make sure first line indicates ok status
    const firstLine = lines.shift();
    if (firstLine?.trim() != 'O') {
        /**
         * Throw specific error if player was not found, else use generic message
         * BF2Hub returns E\t998 if a player was not found
         * PlayBF2 returns a converged list of headers and dummy values in the first line if a player was not found
         * Phoenix Network returns a normal response with an "E" header and "asof" plus "err" headers/values
         */
        const errMsg = firstLine == 'E\t998' || firstLine?.startsWith('O	H	asof	D') || lines?.join('').includes('Player Not Found')
            ? 'Player not found' :
            'Source query resulted in an error';
        throw new Error(errMsg);
    }

    // First, parse lines into datasets with headers and data
    const datasets: {h: string, d: string[]}[] = [];
    // We should see a header first (since we already removed the "status" line
    let lastDelimiterType: 'h' | 'd' = 'h';
    let dataLineIndex = 0;
    for (const line of lines) {
        switch (line.substring(0, 2)) {
            case 'H\t':
                // Line starts with header marker => create and append new dataset
                lastDelimiterType = 'h';
                datasets.push({ h: line.substring(2), d: [] });
                break;
            case 'D\t':
                // Line starts with data marker => append to current dataset
                // If previous line also contained data, append line to same dataset as another line
                if (lastDelimiterType == 'd') {
                    dataLineIndex++;
                }
                lastDelimiterType = 'd';
                datasets[datasets.length - 1].d[dataLineIndex] = line.substring(2);
                break;
            case '$\t':
                // Line starts with end marker => stop parsing
                break;
            default:
                // Line has no marker => append to respective type of current dataset
                if (lastDelimiterType == 'h') {
                    datasets[datasets.length - 1].h += line;
                }
                else {
                    datasets[datasets.length -1].d[dataLineIndex] += line;
                }
        }
    }

    /**
     * All list methods should return two datasets: one containing metadata and one containing results.
     * A common breach of this design: PlayBF2 does not support the rising star leaderboard. If you request it anyway,
     * you get a single, empty dataset (which we cannot sensibly parse into the usual leaderboard response format):
     * O
     * H    size    asof
     * $    10    $
     *
     */
    if (forceReturnArray && datasets.length != 2) {
        throw new Error('Source returned invalid response');
    }

    // Build return object
    const returnObj: Record<string, any> = {}; // eslint-disable-line  @typescript-eslint/no-explicit-any
    for (const [index, dataset] of datasets.entries()) {
        // Split keys into array
        const keys = dataset.h.split('\t');
        // Split each data line into an array
        const dataLines = dataset.d.map((line) => line.split('\t'));

        const propertyKey = propertyKeys?.[index - 1];
        if (index == 0) {
            // "Promote" first line object root (only contains "asof" and similar metadata for most requests)
            for (const [index, key] of keys.entries()) {
                returnObj[key] = dataLines[0]?.[index] ?? '';
            }
        }
        else if (dataLines.length == 1 && !forceReturnArray && propertyKey) {
            // Only a single line of data in current dataset => add as properties under key (child object)
            // Exception: player search returning only a single player (in that case, force return an array)
            returnObj[propertyKey] = {};
            // Add all data attributes under their respective keys
            for (const [index, key] of keys.entries()) {
                returnObj[propertyKey][key] = dataLines[0]?.[index] ?? '';
            }
        }
        else if (propertyKey) {
            // Multiple lines of data => create array of objects
            returnObj[propertyKey] = dataLines.map((line) => Object.fromEntries(line.map((value, index) => [keys[index], value])));
        }
    }

    return returnObj as AspxResponse;
}

function groupStatsByRegex<T extends ArmyStats | ClassStats | VehicleStats | WeaponStats | MapStats>(playerStats: Record<string, string>, keyRegex: RegExp): T[] | undefined {
    // Parse into object first, since some entities don't have consecutive ids (e.g. maps use ...,6, 10, 11, 12, 100,...)
    const grouped: Record<number, Record<string, number | string>> = {};
    for (const key in playerStats) {
        const match = keyRegex.exec(key);
        if (match && match.groups) {
            const index = Number(match.groups.index);
            if (!grouped[index]) {
                grouped[index] = { id: index };
            }
            grouped[index][match.groups.key] = playerStats[key];
        }
    }

    const asArray = Object.values(grouped);

    if (asArray.length == 0) {
        return;
    }

    return asArray as T[];
}
