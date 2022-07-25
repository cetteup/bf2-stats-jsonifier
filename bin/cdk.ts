#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LambdaStack } from '../lib/cdk';


const app = new cdk.App();
new LambdaStack(app, 'bf2-stats-jsonifier-stack', {
    stackName: 'bf2-stats-jsonifier-stack',
    env: {
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT,
    },
});
