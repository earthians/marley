// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.NURSING_TASKS_METHOD =
	"healthcare.healthcare.api.nursing_tasks.get_nursing_tasks";
healthcare.nursing.UPDATE_TASK_METHOD =
	"healthcare.healthcare.api.nursing_tasks.update_nursing_task";

healthcare.nursing.START_TASK = [
	{ status: "In Progress", label: __("Start") },
	{ status: "On Hold", label: __("Hold") },
];

// What a task can become next, from where it is now.
healthcare.nursing.TASK_ACTIONS = {
	Draft: [{ status: "Requested", label: __("Add to Worklist") }],
	Requested: healthcare.nursing.START_TASK,
	Received: healthcare.nursing.START_TASK,
	Accepted: healthcare.nursing.START_TASK,
	Ready: healthcare.nursing.START_TASK,
	"In Progress": [
		{ status: "Completed", label: __("Complete") },
		{ status: "On Hold", label: __("Hold") },
	],
	"On Hold": [{ status: "In Progress", label: __("Resume") }],
	// A missed task can still be picked up late, as a missed dose can.
	Missed: healthcare.nursing.START_TASK,
};

healthcare.nursing.panes.nursing_tasks = class NursingTasksPane extends (
	healthcare.nursing.Pane
) {
	async render() {
		this.render_head(__("Nursing Tasks"));
		await this.refresh_tasks();
	}

	async refresh_tasks() {
		this.tasks = await frappe.xcall(healthcare.nursing.NURSING_TASKS_METHOD, {
			patient: this.patient,
		});
		this.render_tasks();
	}

	render_tasks() {
		const $body = this.render_table(
			[
				{ label: __("Activity") },
				{ label: __("Due"), align: "right" },
				{ label: __("Status") },
				{ label: __("Action") },
			],
			this.tasks,
			task => this.get_task_html(task),
			__("No tasks"),
		);
		if (!$body) return;

		$body.on("click", "[data-status]", event =>
			this.on_action($(event.currentTarget)),
		);
		$body.on("click", "[data-open]", event =>
			frappe.set_route(
				"Form",
				"Nursing Task",
				$(event.currentTarget).attr("data-open"),
			),
		);
	}

	get_task_html(task) {
		const overdue = moment(task.requested_start_time).isBefore(moment());
		return `<tr>
			<td>
				<a href="#" data-open="${task.name}">
					${frappe.utils.escape_html(task.activity || task.name)}
				</a>
				${task.mandatory ? `<span class="text-danger">·&nbsp;${__("Mandatory")}</span>` : ""}
				${
					task.description
						? `<span class="sub">${frappe.utils.escape_html(
								task.description,
						  )}</span>`
						: ""
				}
			</td>
			<td class="text-right ${overdue ? "text-danger" : ""}">
				${moment(task.requested_start_time).format("DD/MM HH:mm")}
			</td>
			<td class="text-muted">${__(task.status)}</td>
			<td>${this.get_actions_html(task)}</td>
		</tr>`;
	}

	get_actions_html(task) {
		const actions = healthcare.nursing.TASK_ACTIONS[task.status] || [];

		return this.render_actions(actions, { task: task.name });
	}

	async on_action($button) {
		await frappe.xcall(healthcare.nursing.UPDATE_TASK_METHOD, {
			task: $button.attr("data-task"),
			status: $button.attr("data-status"),
		});
		frappe.show_alert({ message: __("Task updated"), indicator: "green" });
		await this.refresh_tasks();
		this.station.snapshot.refresh();
	}
};
