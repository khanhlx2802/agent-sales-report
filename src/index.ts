import { Worker } from "@notionhq/workers"
import { j } from "@notionhq/workers/schema-builder"

const worker = new Worker()
export default worker

type Activity = Record<string, unknown>

const text = (value: unknown) =>
	typeof value === "string" ? value.trim() : ""

const firstText = (activity: Activity, keys: string[]) => {
	for (const key of keys) {
		const value = text(activity[key])
		if (value) return value
	}
	return ""
}

const dateOnly = (date: Date) => date.toISOString().slice(0, 10)

function previousWeek(referenceDate?: string | null) {
	const reference = referenceDate
		? new Date(`${referenceDate.slice(0, 10)}T12:00:00Z`)
		: new Date()
	if (Number.isNaN(reference.getTime())) {
		throw new Error("referenceDate must be an ISO date.")
	}

	const day = reference.getUTCDay() || 7
	const start = new Date(reference)
	start.setUTCDate(reference.getUTCDate() - day - 6)
	const end = new Date(start)
	end.setUTCDate(start.getUTCDate() + 6)

	return { start: dateOnly(start), end: dateOnly(end) }
}

function activityDate(activity: Activity) {
	return firstText(activity, [
		"activityDate",
		"Activity Date",
		"date",
		"Date",
		"createdTime",
	])
}

function classifyParty(activity: Activity) {
	const value = firstText(activity, [
		"counterpartyType",
		"Counterparty Type",
		"partyType",
		"Party Type",
		"relationshipType",
		"Relationship Type",
		"activityType",
		"Activity Type",
	]).toLowerCase()

	if (
		value.includes("partner") ||
		value.includes("vendor") ||
		value.includes("đối tác") ||
		value.includes("hãng")
	) {
		return "partner"
	}
	if (
		value.includes("customer") ||
		value.includes("client") ||
		value.includes("khách hàng")
	) {
		return "customer"
	}
	return "unclassified"
}

function opportunityKey(activity: Activity) {
	return (
		firstText(activity, [
			"opportunityProduct",
			"Opportunity Product",
			"opportunity",
			"Opportunity",
			"account",
			"Account",
		]) || "Không xác định"
	)
}

function healthFromOutcome(outcome: string) {
	const normalized = outcome.toLowerCase()
	if (normalized.includes("positive")) return "Healthy"
	if (normalized.includes("negative")) return "At Risk"
	return "Watch"
}

worker.tool("prepareActivitiesJson", {
	title: "Prepare weekly sales activities",
	description:
		"Filter Activities to the previous Monday-Sunday period, split customer and partner interactions, and derive Opportunity Health from the latest meaningful outcome. Call this before drafting the weekly report.",
	hints: { readOnlyHint: true },
	schema: j.object({
		activitiesJson: j
			.string()
			.describe("JSON array of CRM Activity objects loaded by the agent."),
		referenceDate: j
			.string()
			.describe("Optional ISO date used to determine the previous week.")
			.nullable(),
		periodStart: j
			.string()
			.describe("Optional explicit ISO start date; use together with periodEnd.")
			.nullable(),
		periodEnd: j
			.string()
			.describe("Optional explicit ISO end date; use together with periodStart.")
			.nullable(),
	}),
	outputSchema: j.object({
		periodStart: j.string(),
		periodEnd: j.string(),
		customerActivitiesJson: j.string(),
		partnerActivitiesJson: j.string(),
		unclassifiedActivitiesJson: j.string(),
		opportunityHealthJson: j.string(),
	}),
	execute: ({ activitiesJson, referenceDate, periodStart, periodEnd }) => {
		const parsed: unknown = JSON.parse(activitiesJson)
		if (!Array.isArray(parsed)) {
			throw new Error("activitiesJson must contain a JSON array.")
		}

		if ((periodStart && !periodEnd) || (!periodStart && periodEnd)) {
			throw new Error("periodStart and periodEnd must be provided together.")
		}
		const period =
			periodStart && periodEnd
				? { start: periodStart.slice(0, 10), end: periodEnd.slice(0, 10) }
				: previousWeek(referenceDate)
		if (period.start > period.end) {
			throw new Error("periodStart must be on or before periodEnd.")
		}
		const activities = (parsed as Activity[]).filter((activity) => {
			const value = activityDate(activity).slice(0, 10)
			return value >= period.start && value <= period.end
		})

		const customer = activities.filter(
			(activity) => classifyParty(activity) === "customer",
		)
		const partner = activities.filter(
			(activity) => classifyParty(activity) === "partner",
		)
		const unclassified = activities.filter(
			(activity) => classifyParty(activity) === "unclassified",
		)

		const latest = new Map<string, Activity>()
		for (const activity of [...activities].sort((a, b) =>
			activityDate(a).localeCompare(activityDate(b)),
		)) {
			latest.set(opportunityKey(activity), activity)
		}

		const health = [...latest.entries()].map(([opportunity, activity]) => {
			const outcome = firstText(activity, [
				"activityOutcome",
				"Activity Outcome",
				"outcome",
				"Outcome",
			])
			return {
				opportunity,
				health: healthFromOutcome(outcome),
				outcome: outcome || "Không có outcome rõ ràng",
				latestActivityDate: activityDate(activity),
			}
		})

		return {
			periodStart: period.start,
			periodEnd: period.end,
			customerActivitiesJson: JSON.stringify(customer),
			partnerActivitiesJson: JSON.stringify(partner),
			unclassifiedActivitiesJson: JSON.stringify(unclassified),
			opportunityHealthJson: JSON.stringify(health),
		}
	},
})

worker.tool("getWeeklyReportWorkflow", {
	title: "Get weekly sales report workflow",
	description:
		"Return the fixed workflow and report structure used by Sales Weekly Report Agent. Use it together with the agent's instructions; Notion AI remains responsible for reasoning and writing.",
	hints: { readOnlyHint: true },
	schema: j.object({}),
	outputSchema: j.object({
		workflow: j.string(),
		reportSections: j.array(j.string()),
		healthRules: j.string(),
	}),
	execute: () => ({
		workflow:
			"Load the previous Monday-Sunday Activities from the Test worker sales weekly report area and related Opportunity Products; call prepareActivitiesJson; create or update one report page under List of reports in the Dùng thử các tính năng phần mềm area. Do not write to the production Sales Weekly Reports database. Do not send notifications or ping anyone.",
		reportSections: [
			"Tổng quan nhanh",
			"Opportunity Health",
			"Điểm nổi bật trong tuần",
			"Cần chú ý / rủi ro",
			"Trọng tâm tuần tới",
			"Cần sếp hỗ trợ",
			"Kết luận",
		],
		healthRules:
			"Positive → Healthy; Negative → At Risk; Neutral, Waiting, or Blocked → Watch.",
	}),
})
