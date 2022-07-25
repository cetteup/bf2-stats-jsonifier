export type Project = 'bf2hub' | 'playbf2' | 'phoenix'

export type ProjectConfig = {
    baseUrl: string
    defaultHeaders: Record<string, string>
}

export const ProjectConfigs: Record<Project, ProjectConfig> = {
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

export type Source = 'getplayerinfo' | 'getrankinfo' | 'getawardsinfo' | 'getunlocksinfo' | 'getleaderboard' | 'searchforplayers';

export type SourceConfig = {
    endpoint: string
    requiredParams: string[]
    defaultParams: Record<string, string>
    propertyKeys?: string[]
    forceReturnArray?: boolean
}

export const SourceConfigs: Record<Source, SourceConfig> = {
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
    getleaderboard: {
        endpoint: 'getleaderboard.aspx',
        defaultParams: {
            type: 'score',
            id: 'overall'
        },
        requiredParams: [],
        propertyKeys: ['players'],
        forceReturnArray: true
    },
    searchforplayers: {
        endpoint: 'searchforplayers.aspx',
        defaultParams: {},
        requiredParams: ['nick'],
        propertyKeys: ['players'],
        forceReturnArray: true
    }
};
