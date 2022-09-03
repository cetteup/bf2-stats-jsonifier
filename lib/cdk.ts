import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cm from 'aws-cdk-lib/aws-certificatemanager';
import { CorsHttpMethod, DomainName, HttpApi, HttpMethod, } from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as path from 'path';

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

        const dn = new DomainName(this, 'domain-name', {
            domainName: domainName.valueAsString,
            certificate: cert
        });

        const apiGateway = new HttpApi(this, 'api-gateway', {
            apiName: 'bf2-stats-jsonifier',
            disableExecuteApiEndpoint: true,
            corsPreflight: {
                allowMethods: [
                    CorsHttpMethod.GET,
                    CorsHttpMethod.OPTIONS
                ],
                allowOrigins: ['*'],
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token'
                ]
            },
            defaultDomainMapping: {
                domainName: dn,
            },
        });

        const endpoints = ['getplayerinfo', 'getrankinfo', 'getawardsinfo', 'getunlocksinfo', 'getleaderboard', 'searchforplayers'];
        const integration = new HttpLambdaIntegration('query-function-integration', queryFunction);
        for (const endpoint of endpoints) {
            apiGateway.addRoutes({
                path: `/${endpoint}`,
                methods: [HttpMethod.GET],
                integration: integration
            });
        }

        new cdk.CfnOutput(this, 'apiUrl', { value: apiGateway.url! });

        Tags.of(this).add('service', 'bf2-stats-jsonifier');
    }
}
