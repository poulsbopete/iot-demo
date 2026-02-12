# Elastic Workflows for Ecolab IoT Demo

## Ecolab IoT – Root Cause Analysis (RCA)

**File:** `ecolab-iot-rca-workflow.yaml`

Alert-triggered workflow that:

1. Sends the alert payload to an AI agent for IoT-focused root cause analysis (pump failures, dosing, sanitizer, tank leaks, thermal).
2. Asks the agent for a case title and description.
3. Creates an Observability case with that title/description.
4. Attaches the triggering alert to the case.
5. Adds the agent’s reasoning steps and full RCA as comments.

### Import in Kibana

1. Open **Stack Management** → **Workflows** (or your Kibana URL: `/app/management/insights/workflows`).
2. Create a new workflow and paste the contents of `ecolab-iot-rca-workflow.yaml`, or use the Workflows API to create it from the YAML.

### Configuration

- **Trigger:** `alert` — runs when an alert fires. Use rule types that match your IoT demo (e.g. threshold on pump status, dosing rate, sanitizer ppm).
- **Agent:** The workflow uses `agent_id: sre-agent`. If your deployment uses a different agent (e.g. `elastic-ai-agent` for Serverless default), edit the YAML and replace `sre-agent` in all three `converse` steps.
- **Tags:** Cases are created with tags `IoT`, `Ecolab`, `Demo`. Adjust in the `create_case` step if needed.

### Requirements

- Agent Builder with an agent that can query your data (e.g. metrics-generic.otel-default, ecolab-iot-demo).
- Observability cases enabled; API key or user must have privileges to create cases and call Agent Builder Converse.

---

## How to test the workflow

In Kibana, open your workflow and use **Test Workflow**. You can run it in two ways:

### Option 1: Alert (real data)

1. Choose **Alert**.
2. Select an existing alert from an index (e.g. an Observability alert that already fired).
3. Click **Run**.

The workflow receives the real alert event and runs end-to-end.

### Option 2: Manual (simulate an alert)

Use this when you don’t have a real alert yet.

1. Choose **Manual**.
2. Paste one of the JSON payloads below into **Input Data** (the workflow expects an alert-shaped `event`).
3. Click **Run**.

**If the test runner passes the payload as the event itself**, use:

```json
{
  "alerts": [
    {
      "_id": "test-ecolab-iot-alert-1",
      "_index": ".alerts-observability.apm.alerts-default"
    }
  ],
  "rule": {
    "id": "ecolab-iot-pump-failure-rule",
    "name": "Ecolab IoT – Pump failure detected"
  }
}
```

**If the test runner wraps the payload in an `event` key**, use:

```json
{
  "event": {
    "alerts": [
      {
        "_id": "test-ecolab-iot-alert-1",
        "_index": ".alerts-observability.apm.alerts-default"
      }
    ],
    "rule": {
      "id": "ecolab-iot-pump-failure-rule",
      "name": "Ecolab IoT – Pump failure detected"
    }
  }
}
```

The RCA step will receive this as `event`; the agent will analyze it and can query your data. The case will be created and the alert comment will reference this test alert id/index. If a step fails, open that step in the run result to see the error (e.g. Converse, case creation, or conversation fetch).
