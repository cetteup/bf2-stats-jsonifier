import * as cdk from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cm from 'aws-cdk-lib/aws-certificatemanager';
import * as api from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import {Tags} from "aws-cdk-lib";

export class LambdaStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const domainName = new cdk.CfnParameter(this, 'domainName', {
            type: 'String',
            description: 'Custom domain name for API gateway',
        });

        const certArn = new cdk.CfnParameter(this, 'certArn', {
            type: 'String',
            description: 'ARN of existing ACM certificate for custom domain',
        });

        const queryFunction = new NodejsFunction(this, 'query-function', {
            functionName: 'bf2-stats-jsonifier-query',
            memorySize: 128,
            timeout: cdk.Duration.seconds(5),
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: 'main',
            entry: path.join(__dirname, '/../src/index.ts'),
        });

        const cert = cm.Certificate.fromCertificateArn(this, 'cert', certArn.valueAsString);

        const apiGateway = new api.RestApi(this, 'api-gateway', {
            restApiName: 'bf2-stats-jsonifier',
            endpointConfiguration: {
                types: [api.EndpointType.REGIONAL]
            },
            disableExecuteApiEndpoint: true,
            defaultMethodOptions: {
                authorizationType: api.AuthorizationType.NONE
            },
            defaultCorsPreflightOptions: {
                allowMethods: ['GET', 'OPTIONS'],
                allowOrigins: api.Cors.ALL_ORIGINS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token'
                ]
            },
            domainName: {
                domainName: domainName.valueAsString,
                certificate: cert
            }
        });

        const endpoints = ['getplayerinfo', 'getrankinfo', 'getawardsinfo', 'getunlocksinfo', 'getleaderboard', 'searchforplayers'];
        const integration = new api.LambdaIntegration(queryFunction);
        for (const endpoint of endpoints) {
            const res = apiGateway.root.addResource(endpoint);
            res.addMethod('GET', integration);
        }

        Tags.of(this).add('service', 'bf2-stats-jsonifier');

        new cdk.CfnOutput(this, 'apiUrl', { value: apiGateway.url });
    }
}
