# Deploy Runbook (GitHub OIDC -> AWS)

## Prerequisites

- GitHub Actions workflow: `.github/workflows/deploy-aws.yml`
- Repository secret:
  - `AWS_DEPLOY_ROLE_ARN`
- Repository/environment variable:
  - `AWS_REGION`
- EC2 host has:
  - SSM agent active
  - instance profile with SSM + S3 read + Parameter Store read
  - deployment scripts present in `/opt/marketing-automation/current/ops/deploy`

## Deployment flow

1. Trigger `deploy-aws` workflow manually.
2. Provide:
   - `environment` (for example `prod`)
   - `instance_id`
   - `s3_bucket`
3. Workflow performs:
   - `npm ci`
   - `npm run lint`
   - `npm run test:integration`
   - release bundle upload to S3
   - SSM command to execute `deploy-release.sh`

## Rollback

- Run on host (via SSM session):
  - `bash /opt/marketing-automation/current/ops/deploy/rollback-release.sh`
- Verify service:
  - `systemctl status marketing-automation.service`
  - health endpoint check with `ops/systemd/healthcheck.sh`
