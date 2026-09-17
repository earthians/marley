// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.CARE_PLAN_METHOD =
	"healthcare.healthcare.api.nursing_care_plan.get_care_plan";
healthcare.nursing.ACTIVE_ORDERS_METHOD =
	"healthcare.healthcare.api.nursing_care_plan.get_active_orders";
healthcare.nursing.START_CARE_PLAN_METHOD =
	"healthcare.healthcare.api.nursing_care_plan.start_care_plan";
healthcare.nursing.ADD_GOAL_METHOD =
	"healthcare.healthcare.api.nursing_care_plan.add_goal";
healthcare.nursing.SET_GOAL_STATUS_METHOD =
	"healthcare.healthcare.api.nursing_care_plan.set_goal_status";

healthcare.nursing.GOAL_OUTCOMES = [
	{ status: "Met", label: __("Met") },
	{ status: "Not Met", label: __("Not Met") },
	{ status: "In Progress", label: __("In Progress") },
];

// Two halves: goals the nurse sets, and orders the doctor made. Only the first
// is edited here — the orders are shown as they stand.
healthcare.nursing.panes.care_plan = class CarePlanPane extends (
	healthcare.nursing.Pane
) {
	constructor(options) {
		super(options);
		this.controls = {};
	}

	async render() {
		this.render_head(__("Care Plan"));
		await this.refresh();
	}

	async refresh() {
		[this.plan, this.orders] = await Promise.all([
			frappe.xcall(healthcare.nursing.CARE_PLAN_METHOD, {
				patient: this.patient,
			}),
			frappe.xcall(healthcare.nursing.ACTIVE_ORDERS_METHOD, {
				patient: this.patient,
			}),
		]);
		this.render_body();
	}

	render_body() {
		this.$fields.empty();
		this.$actions.empty();
		this.$rows.empty();

		this.make_goal_control();
		this.render_goals();
		this.render_orders();
	}

	// Setting goals is a takeover-time job. Once the plan is running, the form
	// folds away so the goals and orders have the pane to themselves.
	make_goal_control() {
		this.controls.goal = this.make_control({
			fieldtype: "Small Text",
			fieldname: "goal",
			label: this.plan ? __("Add a goal") : __("What are you aiming for?"),
		});
		this.$fields.children().last().addClass("nursing-field-wide");

		this.controls.target_date = this.make_control({
			fieldtype: "Date",
			fieldname: "target_date",
			label: __("Target"),
		});

		if (!this.plan) {
			this.add_button(__("Start Care Plan"), () => this.save_goal());
			return;
		}

		this.$fields.hide();
		this.$add = this.add_button(
			__("Add Goal"),
			() => this.reveal_goal_form(),
			"default",
		);
	}

	reveal_goal_form() {
		this.$fields.show();
		this.$add.remove();
		this.add_button(__("Save Goal"), () => this.save_goal());
		this.controls.goal.set_focus?.();
	}

	async save_goal() {
		const goal = this.controls.goal.get_value();
		const target_date = this.controls.target_date.get_value();

		if (!String(goal || "").trim()) frappe.throw(__("Write the goal first"));

		if (this.plan) {
			await frappe.xcall(healthcare.nursing.ADD_GOAL_METHOD, {
				plan: this.plan.name,
				goal: goal,
				target_date: target_date,
			});
		} else {
			await frappe.xcall(healthcare.nursing.START_CARE_PLAN_METHOD, {
				patient: this.patient,
				goals: [{ goal: goal, target_date: target_date }],
				reference_doctype: this.station.reference_doctype,
				reference_name: this.station.reference_name,
			});
		}

		frappe.show_alert({ message: __("Goal added"), indicator: "green" });
		await this.refresh();
	}

	render_goals() {
		const $card = this.add_card(
			__("Goals"),
			this.plan ? this.get_started_label() : "",
		);
		const goals = this.plan ? this.plan.goals : [];

		if (!goals.length) {
			$card.html(this.empty(__("No goals set yet")));
			return;
		}

		goals.forEach(goal => $card.append(this.get_goal_html(goal)));
		$card.on("click", "[data-status]", event =>
			this.set_status($(event.currentTarget)),
		);
	}

	get_started_label() {
		return `${__("Started by {0}", [this.plan.started_by])}`;
	}

	get_goal_html(goal) {
		return `<div class="nursing-stacked-row">
			<div class="nursing-stacked-label">${frappe.utils.escape_html(goal.goal)}</div>
			<div class="nursing-stacked-meta">
				<span>
					${goal.target_date ? moment(goal.target_date).format("DD/MM") : ""}
					<span class="${this.get_goal_indicator(goal)}">${__(goal.status)}</span>
				</span>
				<span>${this.get_goal_actions(goal)}</span>
			</div>
		</div>`;
	}

	// Where it stands reads as a label; changing it lives behind Actions, the
	// same as a dose or a task.
	get_goal_actions(goal) {
		const options = healthcare.nursing.GOAL_OUTCOMES.filter(
			outcome => outcome.status !== goal.status,
		);
		return this.render_actions(options, { goal: goal.name });
	}

	get_goal_indicator(goal) {
		if (goal.status === "Met") return "text-success";
		return goal.status === "Not Met" ? "text-danger" : "text-muted";
	}

	async set_status($button) {
		await frappe.xcall(healthcare.nursing.SET_GOAL_STATUS_METHOD, {
			plan: this.plan.name,
			goal: $button.attr("data-goal"),
			status: $button.attr("data-status"),
		});
		await this.refresh();
	}

	// The doctor's orders, shown as they stand. Copying them into the plan
	// would only drift the moment an order changes.
	render_orders() {
		const $card = this.add_card(
			__("Active Orders"),
			String(this.orders.length || ""),
		);

		if (!this.orders.length) {
			$card.html(this.empty(__("Nothing outstanding")));
			return;
		}
		this.orders.forEach(order => $card.append(this.get_order_html(order)));
	}

	get_order_html(order) {
		return `<div class="nursing-row">
			<span class="nursing-row-time">${
				order.order_date ? moment(order.order_date).format("DD/MM") : ""
			}</span>
			<span class="nursing-row-label">
				${frappe.utils.escape_html(order.label || order.description || order.name)}
			</span>
			<span class="nursing-row-status">${__(
				order.order_doctype.replace(" Request", ""),
			)}</span>
		</div>`;
	}

	add_card(title, note) {
		const $card = $(`
			<div class="nursing-card">
				<div class="nursing-card-head">
					<span class="nursing-card-title">${title}</span>
					<span class="when">${note || ""}</span>
				</div>
				<div class="nursing-card-body"></div>
			</div>
		`).appendTo(this.$rows);
		return $card.find(".nursing-card-body");
	}
};
