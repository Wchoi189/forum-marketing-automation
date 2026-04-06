# Remote Access Runbook (SSM-First)

This runbook defines standard operator access and break-glass SSH behavior.

## Standard access path

1. Authenticate to AWS with MFA.
2. Start Session Manager session:
   - `aws ssm start-session --target <instance-id>`
3. Switch to service context if needed:
   - `sudo -u marketing-automation -H bash -lc 'pwd && whoami'`
4. Perform operational action and record change details in the session handover.

## No-SSH baseline check

- Confirm security group has no inbound `22`.
- Confirm shell access works through SSM.
- If SSM fails due to host agent issue, escalate to break-glass policy.

## Break-glass SSH policy

Use only when all conditions are true:

- SSM is unavailable or impaired.
- Active incident is declared.
- Operator with MFA and approved role is assigned.

### Break-glass steps

1. Add temporary inbound `22` rule to security group from one approved source IP.
2. Verify key-only SSH access.
3. Perform recovery action.
4. Remove inbound `22` rule immediately.
5. Log incident details, operator identity, reason, and closeout timestamp.

## Optional zero-trust access

- For dashboard/admin access, front with either:
  - Tailscale ACL policy, or
  - Cloudflare Access app policy.
- Keep host security group and IAM constraints unchanged.

## Guardrails

- Never store secrets in runbooks, repo, or shell history artifacts.
- Avoid persistent SSH exposure.
- Prefer reversible, auditable changes and include rollback notes in each handover.
