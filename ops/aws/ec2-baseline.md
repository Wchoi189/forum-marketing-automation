# EC2 Baseline (Hardened)

This baseline is the default for production-like deployments of `marketing-automation`.

## Instance profile and IAM

- Attach an instance profile with:
  - `AmazonSSMManagedInstanceCore`
  - `CloudWatchAgentServerPolicy`
- For SSM Parameter Store reads, add least-privilege `ssm:GetParameter` and `ssm:GetParametersByPath` for `/marketing-automation/prod/*`.
- Enforce MFA on operator IAM principals that can start SSM sessions or apply break-glass network changes.

## Network posture

- Security group defaults:
  - Inbound: deny all by default.
  - Allow `80`/`443` if public app access is required.
  - Keep `22` closed by default.
- Optional break-glass SSH:
  - Temporarily allow `22` from a single known operator IP.
  - Remove the rule immediately after incident mitigation.

## Host runtime prerequisites

- OS: Ubuntu LTS.
- Packages:
  - Node.js LTS runtime.
  - Playwright Linux dependencies and Chromium runtime libs.
  - `awscli`, `jq`, `unzip`, `curl`, `ca-certificates`.
- Recommended directories:
  - `/opt/marketing-automation/releases`
  - `/opt/marketing-automation/shared`
  - `/opt/marketing-automation/shared/artifacts`

## Service user model

- Create a dedicated user:
  - username: `marketing-automation`
  - shell: `/usr/sbin/nologin`
  - home: `/opt/marketing-automation`
- Ownership:
  - `marketing-automation:marketing-automation` owns `/opt/marketing-automation`.
  - Deployment user/group can write release artifacts but cannot read decrypted secrets unless required.

## Validation checklist

- `aws ssm start-session` works without inbound SSH.
- Security group has no persistent inbound port `22`.
- Service user owns runtime and artifact directories.
- CloudWatch logs can be published from the instance profile.
