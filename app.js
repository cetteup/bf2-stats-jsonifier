const fetch = require('node-fetch');

const projects = {
    bf2hub: {
        baseUrl: 'http://official.ranking.bf2hub.com/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0',
            Host: 'BF2web.gamespy.com'
        }
    },
    playbf2: {
        baseUrl: 'http://bf2web.playbf2.ru/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0'
        }
    },
    phoenix: {
        baseUrl: 'http://bf2.phoenixnetwork.net/ASP/',
        defaultHeaders: {
            'User-Agent': 'GameSpyHTTP/1.0'
        }
    }
};

const sources = {
    getplayerinfo: {
        endpoint: 'getplayerinfo.aspx',
        defaultParams: {
            info: 'per*,cmb*,twsc,cpcp,cacp,dfcp,kila,heal,rviv,rsup,rpar,tgte,dkas,dsab,cdsc,rank,cmsc,kick,kill,deth,suic,ospm,klpm,klpr,dtpr,bksk,wdsk,bbrs,tcdr,ban,dtpm,lbtl,osaa,vrk,tsql,tsqm,tlwf,mvks,vmks,mvn*,vmr*,fkit,fmap,fveh,fwea,wtm-,wkl-,wdt-,wac-,wkd-,vtm-,vkl-,vdt-,vkd-,vkr-,atm-,awn-,alo-,abr-,ktm-,kkl-,kdt-,kkd-'
        },
        requiredParams: ['pid'],
        propertyKeys: ['player']
    },
    getrankinfo: {
        endpoint: 'getrankinfo.aspx',
        requiredParams: ['pid'],
        defaultParams: {}
    },
    getawardsinfo: {
        endpoint: 'getawardsinfo.aspx',
        defaultParams: {},
        requiredParams: ['pid'],
        propertyKeys: ['awards']
    },
    getunlocksinfo: {
        endpoint: 'getunlocksinfo.aspx',
        defaultParams: {},
        requiredParams: ['pid'],
        propertyKeys: ['status', 'unlocks']
    },
    searchforplayers: {
        endpoint: 'searchforplayers.aspx',
        defaultParams: {},
        requiredParams: ['nick'],
        propertyKeys: ['players'],
        forceReturnArray: true
    }
};

exports.lambdaHandler = async (event) => {
    // Init response
    let response = {
        headers: { 'Content-Type': 'application/json' }
    };

    // Try to fetch data from cache or source
    try {
        // Makre sure given source is valid (check if path without leading slash is a source key)
        // Note: such an event ever reaching the Lambda function would indicate a misconfigured API gateway
        const sourceKey = String(event.path || event.requestContext.http.path).substr(1);
        if (!(sourceKey in sources)) {
            response.statusCode = 404;
            throw new Error('Invalid source provided');
        }

        // Make sure required query params have been provided
        const requiredParamsPresent = sources[sourceKey].requiredParams.every((param) => Object.keys(event.queryStringParameters).includes(param) && event.queryStringParameters[param].trim().length > 0);
        if (!event.queryStringParameters || !requiredParamsPresent) {
            response.statusCode = 422;
            throw new Error('Missing required query string paramter(s)');
        }

        // Sending a search player search with "where=e" (endswith) to BF2 always results in a timeout on their end, so block requests with "where=e"
        if (sourceKey === 'searchforplayers' && event.queryStringParameters.where && event.queryStringParameters.where.toLowerCase() === 'e') {
            response.statusCode = 422;
            throw new Error('searchforplayers does not support "endswith"/"where=e" search');
        }

        // Determine BF2 "revive" project to request data from (defaulting to BF2Hub)
        const project = event?.queryStringParameters?.project in projects ? projects[event.queryStringParameters.project] : projects.bf2hub;

        const stats = await fetchFromSource(project, sources[sourceKey], event.queryStringParameters);

        // Finish setting up response
        response.statusCode = 200;
        response.headers['Cache-Control'] = `max-age=${process.env.CACHE_TTL || 600}`;
        response.body = JSON.stringify(stats);
    } catch (err) {
        console.log(err);
        if (err.message === 'Player not found') {
            response.statusCode = 404;
        }
        // If no response has been set, use 500
        if (!response.statusCode) response.statusCode = 500;
        response.body = JSON.stringify({ errors: [err.message] });
    }

    return response;
};

async function fetchFromSource(project, source, eventQueryParameters) {
    let response;
    const queryParams = { ...source.defaultParams, ...eventQueryParameters };
    const url = new URL(source.endpoint + '?' + Object.entries(queryParams).map((param) => `${param[0]}=${param[1]}`).join('&'), project.baseUrl);
    response = await fetch(url, {
        headers: project.defaultHeaders
    });

    // Parse BF2 data format
    const rawResponse = await response.text();
    const parsedResponse = await parseBf2Response(rawResponse, source.propertyKeys, source.forceReturnArray);

    return parsedResponse;
}

async function parseBf2Response(rawResponse, propertyKeys, forceReturnArray = false) {
    // Split response into lines
    let lines = rawResponse.split('\n');

    // Make sure first line indicates ok status
    const firstLine = lines.shift();
    if (firstLine.trim() != 'O') {
        /**
         * Throw specific error if player was not found, else use generic message
         * BF2Hub returns E\t998 if a player was not found
         * PlayBF2 returns a converged list of headers and dummy values in the first line if a player was not found
         * Phoenix Network returns a normal response with an "E" header and "asof" plus "err" headers/values
         */
        const errMsg = firstLine == 'E\t998' || firstLine.startsWith('O	H	asof	D') || lines.join('').includes('Player Not Found')
            ? 'Player not found' :
            'Source query resulted in an error';
        throw new Error(errMsg);
    }

    // First, parse lines into datasets with headers and data
    let datasets = [];
    let lastDelimiterType;
    let dataLineIndex = 0;
    lines.forEach((line) => {
        switch (line.substr(0, 2)) {
        case 'H\t':
            lastDelimiterType = 'h';
            datasets.push({ h: line.substr(2), d: [] });
            break;
        case 'D\t':
            // If a data is followed by a data row, copy headers and create a new entry
            if (lastDelimiterType === 'd') {
                dataLineIndex++;
            }
            lastDelimiterType = 'd';
            datasets[datasets.length - 1].d[dataLineIndex] = line.substr(2);
            break;
        case '$\t':
            break;
        default:
            datasets[datasets.length - 1][lastDelimiterType] += line;
        }
    });

    // Build return object
    let returnObj = {};
    datasets.forEach((dataset, datasetIndex) => {
        // Split keys into array
        const keys = dataset.h.split('\t');
        // Split each data line into an array
        const dataLines = dataset.d.map((line) => line.split('\t'));
        // "Promote" first line object root (only contains "asof" and similar metadata for most requests)
        if (datasetIndex === 0) {
            keys.forEach((key, index) => returnObj[key] = dataLines[0][index]);
        }
        // Only a single line of data, add as properties under key (child object)
        // exception: player search returning only a single player (in that case, force return an array)
        else if (dataLines.length === 1 && !forceReturnArray) {
            const propertyKey = propertyKeys[datasetIndex - 1];
            returnObj[propertyKey] = {};
            keys.forEach((key, index) => returnObj[propertyKey][key] = dataLines[0][index]);
        }
        // Multiple lines of data, create array of objects
        else {
            const propertyKey = propertyKeys[datasetIndex - 1];
            returnObj[propertyKey] = dataLines.map((line) => Object.fromEntries(line.map((value, index) => [keys[index], value])));
        }
    });

    return returnObj;
}