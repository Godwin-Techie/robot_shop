# Incident Drill Postmortem: Payment Gateway Failure

**Date:** 2026-10-26  
**Environment:** Robot Shop capstone AKS cluster  
**Type:** Controlled incident drill  
**Status:** Payment service recovered; rolling SLO alert remains active until
the error ratio falls below its threshold.

## Summary

During a controlled drill, the payment service was configured to use the
reserved, non-resolving hostname `gateway.slo-drill.invalid`. Payment attempts
then returned HTTP 500 when the service could not resolve the gateway host.
Grafana detected that combined API availability had fallen below its 99%
rolling 24-hour objective and sent the alert to the configured Slack channel.
The normal gateway configuration was restored, and the payment Deployment
returned to Ready.

## Impact

- Payment requests made while the drill configuration was active failed.
- The 150 deliberately generated test requests returned HTTP 500. Normal load
  traffic also encountered failures during the drill.
- Prometheus later estimated approximately 171 payment HTTP 500 responses in
  the preceding 10 minutes. This is an `increase()` estimate and includes
  normal load traffic as well as the deliberate test requests.
- The combined rolling 24-hour availability SLI measured approximately 98.78%,
  below the 99% objective.
- The drill took place in the capstone environment. No production impact was
  reported. Synthetic test requests failed before order creation.

## Detection

The Grafana alert rule **Combined API availability below 99%** entered the
Firing state. The configured Slack contact point delivered the notification.

## Timeline

Times below are local cluster/operator times, rounded to the nearest minute.

| Time | Event |
|---|---|
| 19:43 | Applied the temporary unreachable payment gateway setting. |
| 19:44 | A single verification request returned HTTP 500 as expected. |
| 19:44–19:47 | Sent 150 bounded synthetic payment requests; each returned HTTP 500. Normal load traffic continued. |
| 19:47 | Restored the Helm value to `payment.gateway: null`. |
| 19:48 | Confirmed the replacement payment pod was Ready and the temporary gateway override was absent. |
| After recovery | Confirmed the combined SLI was about 98.78%, and Grafana fired the alert to Slack. |

## Cause

The failure was intentionally introduced for the drill by setting
`PAYMENT_GATEWAY` to a reserved `.invalid` hostname. DNS resolution failed, and
the payment handler returned HTTP 500.

The drill also exposed a Helm template indentation issue in the optional
`payment.gateway` environment variable block. The chart rendered successfully
while the value was unset, but failed YAML parsing when the value was supplied.
The template was corrected and render-checked both with and without the
optional value before proceeding.

## Response and recovery

The gateway setting was restored through Helm using the repository values.
The payment Deployment completed its rollout with one Ready replica. The
payment service returned to its normal configuration.

The alert can remain Firing after service recovery because the error responses
remain in the rolling 24-hour SLI window. It will resolve only when enough
successful requests dilute the measured error ratio below the 1% budget (or
when older failures age out of the window).

## What went well

- The failure was bounded and reversible.
- The first request was checked before sending the batch.
- The payment service and other application services remained deployed.
- Prometheus recorded the failures, Grafana evaluated the SLO, and Slack
  received the alert.
- The Helm template issue was caught before applying the temporary
  configuration and was fixed with a render check.

## Follow-up actions

| Action | Status |
|---|---|
| Keep the payment gateway at its normal value after the drill. | Complete |
| Correct and render-check the optional payment gateway template block. | Complete |
| Add per-service availability views or SLOs so a combined request-weighted score cannot mask one service. | Open |
| Add a separate service-health or synthetic availability alert for outages with no requests. | Open |
| Confirm whether Grafana sends a resolved notification to Slack after the rolling SLI recovers. | Open |
| Reassess Prometheus retention before making claims over a window longer than 24 hours. | Open |

## Blameless learning

The alert rule, metric naming differences, optional Helm configuration, and
rolling-window behavior were not yet familiar parts of the system. The drill
made those behaviors visible and provided a safe way to practice detection and
recovery. The follow-up work focuses on making service-specific failures,
no-traffic outages, and alert resolution easier to see.
