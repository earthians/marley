// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.OUTSTANDING_METHOD =
	"healthcare.healthcare.api.handover.get_outstanding";
healthcare.nursing.RECORD_HANDOVER_METHOD =
	"healthcare.healthcare.api.handover.record_handover";
healthcare.nursing.HANDOVERS_METHOD =
	"healthcare.healthcare.api.handover.get_handovers";
healthcare.nursing.ACCEPT_HANDOVER_METHOD =
	"healthcare.healthcare.api.handover.accept_handover";

healthcare.nursing.HANDOVER_FIELDS = [
	{
		fieldname: "handed_over_to",
		label: __("Handed Over To"),
		fieldtype: "Link",
		options: "User",
		reqd: 1,
		description: __("The nurse taking over; they accept the handover"),
		// You cannot hand over to yourself, so do not offer it and then refuse.
		get_query: () => ({
			filters: {
				enabled: 1,
				name: ["not in", [frappe.session.user, "Guest"]],
			},
		}),
	},
	{ fieldname: "from_shift", label: __("From Shift"), fieldtype: "Data" },
	{ fieldname: "to_shift", label: __("To Shift"), fieldtype: "Data" },
];

// SBAR: the handover format, so nothing important is left to memory.
healthcare.nursing.SBAR_FIELDS = [
	{
		fieldname: "situation",
		label: __("Situation — why this patient needs attention now"),
		fieldtype: "Small Text",
		reqd: 1,
	},
	{
		fieldname: "background",
		label: __("Background — what they need to know"),
		fieldtype: "Small Text",
	},
	{
		fieldname: "assessment",
		label: __("Assessment — what you think is going on"),
		fieldtype: "Small Text",
	},
	{
		fieldname: "recommendation",
		label: __("Recommendation — what you are asking them to do"),
		fieldtype: "Small Text",
	},
];

// What a handover cannot do without: someone to hand to, and the reason.
healthcare.nursing.HANDOVER_REQUIRED = [
	{ fieldname: "handed_over_to", label: __("Handed Over To") },
	{ fieldname: "situation", label: __("Situation") },
];

healthcare.nursing.panes.handover = class HandoverPane extends healthcare.nursing.Pane {
	constructor(options) {
		super(options);
		this.controls = {};
	}

	async render() {
		this.render_head(__("Shift Handover"));
		await this.refresh();
	}

	// One patient, one live handover. Until it is accepted the patient cannot be
	// handed on again, so the form stays out of the way.
	get pending() {
		return this.handovers.find(handover => handover.status === "Handed Over");
	}

	get incoming() {
		const pending = this.pending;
		return pending && pending.handed_over_to === frappe.session.user
			? pending
			: null;
	}

	render_body() {
		this.$fields.empty();
		this.$actions.empty();
		this.$rows.empty();

		if (this.incoming) {
			this.render_incoming();
		} else if (this.pending) {
			this.render_awaiting();
		} else {
			this.make_controls();
			this.add_button(__("Hand Over"), () => this.station.commit());
		}

		this.render_outstanding();
		this.render_handovers();
	}

	render_awaiting() {
		const handover = this.pending;
		this.$fields.html(`
			<div class="nursing-card">
				<div class="nursing-card-head">
					<span class="nursing-card-title">${__("Handover in progress")}</span>
					<span class="when">${moment(handover.handover_time).format("DD/MM HH:mm")}</span>
				</div>
				<div class="nursing-card-body">
					<div class="nursing-empty">
						${__("Waiting for {0} to accept before this patient can be handed on again", [
							handover.handed_over_to,
						])}
					</div>
				</div>
			</div>
		`);
	}

	render_incoming() {
		const handover = this.incoming;
		const $card = $(`
			<div class="nursing-card">
				<div class="nursing-card-head">
					<span class="nursing-card-title">${__("Handed over to you")}</span>
					<span class="when">${moment(handover.handover_time).format("DD/MM HH:mm")}</span>
				</div>
				<div class="nursing-card-body">
					<div class="nursing-stacked-label">
						${frappe.utils.escape_html(handover.situation || "")}
					</div>
					<div class="nursing-stacked-meta">
						<span>${__("From {0}", [handover.handed_over_by])}</span>
					</div>
				</div>
			</div>
		`).appendTo(this.$fields);

		$(
			`<button type="button" class="btn btn-sm btn-primary">${__(
				"Accept Handover",
			)}</button>`,
		)
			.appendTo(this.$actions)
			.on("click", () => this.accept(handover.name));

		return $card;
	}

	make_controls() {
		healthcare.nursing.HANDOVER_FIELDS.forEach(field => {
			this.controls[field.fieldname] = this.make_control(field);
		});
		healthcare.nursing.SBAR_FIELDS.forEach(field => {
			this.controls[field.fieldname] = this.make_control(field);
			this.$fields.children().last().addClass("nursing-field-wide");
		});
	}

	fields() {
		return [
			...healthcare.nursing.HANDOVER_FIELDS,
			...healthcare.nursing.SBAR_FIELDS,
		];
	}

	read_controls() {
		const values = {};
		this.fields().forEach(field => {
			values[field.fieldname] = this.controls[field.fieldname].get_value();
		});
		return values;
	}

	async refresh() {
		[this.outstanding, this.handovers] = await Promise.all([
			frappe.xcall(healthcare.nursing.OUTSTANDING_METHOD, {
				patient: this.patient,
			}),
			frappe.xcall(healthcare.nursing.HANDOVERS_METHOD, {
				patient: this.patient,
			}),
		]);
		this.render_body();
	}

	// Gathered rather than retyped: the next nurse inherits these either way.
	render_outstanding() {
		const items = [
			...this.outstanding.tasks.map(item => ({ ...item, kind: __("Task") })),
			...this.outstanding.medications.map(item => ({
				...item,
				kind: __("Medication"),
			})),
		];

		const $card = $(`
			<div class="nursing-card">
				<div class="nursing-card-head">
					<span class="nursing-card-title">${__("Carried Forward")}</span>
					<span class="when">${items.length || ""}</span>
				</div>
				<div class="nursing-card-body"></div>
			</div>
		`).appendTo(this.$rows);

		const $body = $card.find(".nursing-card-body");
		if (!items.length) {
			$body.html(this.empty(__("Nothing outstanding")));
			return;
		}

		items
			.sort((one, other) => (one.when > other.when ? 1 : -1))
			.forEach(item => $body.append(this.get_item_html(item)));
	}

	get_item_html(item) {
		return `<div class="nursing-row">
			<span class="nursing-row-time">${
				item.when ? moment(item.when).format("DD/MM HH:mm") : ""
			}</span>
			<span class="nursing-row-label">${frappe.utils.escape_html(item.label)}</span>
			<span class="nursing-row-status">${__(item.status)}</span>
		</div>`;
	}

	render_handovers() {
		const $wrapper = $(`<div class="nursing-handovers"></div>`).appendTo(
			this.$rows,
		);

		this.render_table(
			[
				{ label: __("Handed Over To") },
				{ label: __("When"), align: "right" },
				{ label: __("Status") },
			],
			this.handovers,
			handover => this.get_handover_html(handover),
			__("No handovers yet"),
			$wrapper,
		);
	}

	// Accepting happens at the top of the pane, so the history only reports.
	get_status_html(handover) {
		if (handover.status === "Accepted") {
			return `<span class="text-muted">${__("Accepted")}</span>`;
		}

		return `<span class="text-muted">${__("Awaiting {0}", [
			handover.handed_over_to,
		])}</span>`;
	}

	get_handover_html(handover) {
		return `<tr>
			<td>
				<b>${frappe.utils.escape_html(handover.handed_over_to)}</b>
				${
					handover.situation
						? `<span class="sub">${frappe.utils.escape_html(
								handover.situation,
						  )}</span>`
						: ""
				}
			</td>
			<td class="text-right text-muted">
				${moment(handover.handover_time).format("DD/MM HH:mm")}
			</td>
			<td>${this.get_status_html(handover)}</td>
		</tr>`;
	}

	async accept(handover) {
		await frappe.xcall(healthcare.nursing.ACCEPT_HANDOVER_METHOD, {
			handover: handover,
		});
		frappe.show_alert({ message: __("Handover accepted"), indicator: "green" });
		await this.refresh();
		this.station.mark_attention();
	}

	// One message naming everything that is missing, rather than one throw per
	// field discovered in turn.
	missing(values) {
		return healthcare.nursing.HANDOVER_REQUIRED.filter(
			field => !String(values[field.fieldname] || "").trim(),
		).map(field => field.label);
	}

	async save() {
		const values = this.read_controls();
		const missing = this.missing(values);

		if (missing.length) {
			frappe.throw(__("Fill in {0}", [missing.join(", ")]));
		}

		await frappe.xcall(healthcare.nursing.RECORD_HANDOVER_METHOD, {
			patient: this.patient,
			reference_doctype: this.station.reference_doctype,
			reference_name: this.station.reference_name,
			values: values,
		});
		this.render_form_again();
	}

	render_form_again() {
		healthcare.nursing.SBAR_FIELDS.forEach(field =>
			this.controls[field.fieldname].set_value(""),
		);
	}
};
