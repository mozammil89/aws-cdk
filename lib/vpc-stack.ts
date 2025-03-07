import * as cdk from "aws-cdk-lib";
import { StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { ConfigProps } from "./config";

type AwsEnvStackProps = StackProps & {
    config: Readonly<ConfigProps>;
};

// Provisions VPC with 3 Subnets (App, DB & Public)
export class vpcStack extends cdk.Stack {
    public readonly vpc: ec2.Vpc;
    
    constructor(scope: Construct, id: string, props: AwsEnvStackProps) {
        super(scope, id, props);

        const { config } = props;
        const cidr = config.CIDR;
        const MAX_AZS = config.MAX_AZS;

        this.vpc = new ec2.Vpc(this, "sbrc2", {
            maxAzs: MAX_AZS,
            ipAddresses: ec2.IpAddresses.cidr(cidr),
            natGateways: 1,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: "public-",
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: "app-pvt-",
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 24,
                    name: "db-pvt-",
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });

        // Enable VPC Flow Logs
        this.vpc.addFlowLog("VpcFlowLog");
    }
}
