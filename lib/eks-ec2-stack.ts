
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ConfigProps } from "./config";
import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31' 

export interface EksEC2StackProps extends cdk.StackProps {
    config: ConfigProps;
    vpc: ec2.Vpc;
}

export class eksec2Stack extends cdk.Stack {
    public readonly eksCluster: eks.Cluster;
    constructor(scope: Construct, id: string, props: EksEC2StackProps) {
        super(scope, id, props);
        const vpc = props.vpc;
        const cidr = props.config.CIDR;
        const ROLE_ARN = props.config.ROLE_ARN;
        const EKS_CLUSTER_NAME = props.config.EKS_CLUSTER_NAME;

        const securityGroupEKS = new ec2.SecurityGroup(this, "EKSSecurityGroup", {
            vpc: vpc,
            allowAllOutbound: true,
            description: "Security group for EKS",
        });

        securityGroupEKS.addIngressRule(
            ec2.Peer.ipv4(cidr),
            ec2.Port.allTraffic(),
            "Allow EKS traffic"
        );

        const iamRole = iam.Role.fromRoleArn(this, "MyIAMRole", ROLE_ARN);

        const readonlyRole = new iam.Role(this, "ReadOnlyRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        });

        readonlyRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess")
        );

        this.eksCluster = new eks.Cluster(this, "eksec2Cluster", {
            vpc: vpc,
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
            defaultCapacity: 3,
            defaultCapacityInstance: new ec2.InstanceType("t3.large"),
            kubectlLayer: new KubectlV31Layer(this, "kubectl"),
            version: eks.KubernetesVersion.V1_31,
            //securityGroup: securityGroupEKS,
            endpointAccess: eks.EndpointAccess.PRIVATE,
            //endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
            ipFamily: eks.IpFamily.IP_V4,
            clusterName: EKS_CLUSTER_NAME,
            mastersRole: iamRole,
            outputClusterName: true,
            authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
            outputConfigCommand: true,
            // Enable Cluster Logging
            clusterLogging: [
                eks.ClusterLoggingTypes.API,
                eks.ClusterLoggingTypes.AUTHENTICATOR,
                eks.ClusterLoggingTypes.SCHEDULER,
                eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
                eks.ClusterLoggingTypes.AUDIT,
            ],
            albController: {
                version: eks.AlbControllerVersion.V2_8_2,
                repository: "public.ecr.aws/eks/aws-load-balancer-controller",
            },
        });

        const key1 = this.eksCluster.openIdConnectProvider.openIdConnectProviderIssuer;

        const stringEquals = new cdk.CfnJson(this, 'ConditionJson', {
            value: {
                [`${key1}:sub`]: `system:serviceaccount:kube-system:ebs-csi-controller-sa`,
                [`${key1}:aud`]: `sts.amazonaws.com`
            },
        });

        // Define an IAM Role
        const oidcEKSCSIRole = new iam.Role(this, "OIDCRole", {
            assumedBy: new iam.FederatedPrincipal(
                `arn:aws:iam::${this.account}:oidc-provider/${this.eksCluster.clusterOpenIdConnectIssuer}`,
                {
                    StringEquals: stringEquals,

                },
                "sts:AssumeRoleWithWebIdentity"
            ),
        });

        // Attach a managed policy to the role
        oidcEKSCSIRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEBSCSIDriverPolicy"))

        new eks.CfnAddon(this, "addonEbsCsi", {
            addonName: "aws-ebs-csi-driver",
            clusterName: this.eksCluster.clusterName,
            serviceAccountRoleArn: oidcEKSCSIRole.roleArn
        });

        new cdk.CfnOutput(this, String("OIDC-issuer"), {
            value: this.eksCluster.clusterOpenIdConnectIssuer,
        });

        new cdk.CfnOutput(this, String("OIDC-issuerURL"), {
            value: this.eksCluster.clusterOpenIdConnectIssuerUrl,
        });

        new cdk.CfnOutput(this, "EKS Cluster Name", {
            value: this.eksCluster.clusterName,
        });

        new cdk.CfnOutput(this, "EKS Cluster Arn", {
            value: this.eksCluster.clusterArn,
        });

    }
}