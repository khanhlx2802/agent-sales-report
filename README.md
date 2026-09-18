# agent_weekly_report

Deterministic helper Worker for the DIBIZ Sales Weekly Report Agent.

## Capabilities

- `prepareActivitiesJson`: filters either the previous Monday-Sunday period or
  an explicit `periodStart`/`periodEnd` range, separates customer and partner
  interactions, and maps the latest activity outcome to Opportunity Health.
- `getWeeklyReportWorkflow`: returns the approved report workflow, section
  order, and health rules.

The Worker does not call Gemini, Claude, or another external model. A Notion
Custom Agent performs the AI reasoning and writes the report.

## Validate and deploy

```bash
npm run check
ntn workers deploy
```