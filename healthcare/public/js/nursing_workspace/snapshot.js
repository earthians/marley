// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.SNAPSHOT_METHOD = "healthcare.healthcare.api.nursing.get_snapshot";

// Vitals share no scale, so one chart shows one template at a time.
healthcare.nursing.Snapshot = class Snapshot {
	constructor({ wrapper, patient, layout = "rail" }) {
		this.$wrapper = $(wrapper);
		this.patient = patient;
		this.layout = layout;
		this.selected_vital = null;
	}

	async refresh() {
		this.data = await this.fetch();
		this.render();
	}

	fetch() {
		return frappe.xcall(healthcare.nursing.SNAPSHOT_METHOD, {
			patient: this.patient,
		});
	}

	render() {
		this.$wrapper.empty().addClass(`nursing-snapshot-${this.layout}`);
		this.render_vitals();
		this.render_next_tasks();
		this.render_last_note();
		this.render_pending();
	}

	add_card(title, action = "") {
		const $card = $(`
			<div class="nursing-card">
				<div class="nursing-card-head">
					<span class="nursing-card-title">${title}</span>
					<span class="nursing-card-action">${action}</span>
				</div>
				<div class="nursing-card-body"></div>
			</div>
		`);
		this.$wrapper.append($card);
		return $card.find(".nursing-card-body");
	}

	// ---- vitals ----

	render_vitals() {
		const templates = this.get_recorded_vitals();
		const $body = this.add_card(__("Vitals"));

		if (!templates.length) {
			$body.html(this.get_empty(__("No vitals recorded yet")));
			return;
		}

		this.selected_vital = templates.includes(this.selected_vital)
			? this.selected_vital
			: templates[0];
		this.render_vital_selector($body, templates);
		this.$chart_area = $(`<div class="nursing-chart"></div>`).appendTo($body);
		this.render_chart();
	}

	get_recorded_vitals() {
		const vitals = this.data.vitals || {};
		return Object.keys(vitals).filter(template => (vitals[template] || []).length);
	}

	render_vital_selector($body, templates) {
		const $selector = $(`<div class="nursing-vital-selector"></div>`).appendTo(
			$body,
		);
		templates.forEach(template => {
			const selected = template === this.selected_vital ? "selected" : "";
			$selector.append(`<button type="button" class="nursing-vital ${selected}"
				data-template="${frappe.utils.escape_html(template)}">${__(template)}</button>`);
		});
		$selector.on("click", "[data-template]", event => {
			this.selected_vital = $(event.currentTarget).attr("data-template");
			this.render();
		});
	}

	render_chart() {
		const readings = this.data.vitals[this.selected_vital] || [];
		this.chart = new frappe.Chart(this.$chart_area.get(0), {
			data: {
				labels: readings.map(reading => this.format_time(reading.recorded_at)),
				datasets: [
					{
						name: this.selected_vital,
						values: readings.map(reading => Number(reading.value)),
					},
				],
			},
			type: "line",
			height: this.layout === "rail" ? 150 : 200,
			colors: ["#318AD8"],
			axisOptions: { xIsSeries: true, xAxisMode: "tick" },
			lineOptions: { hideDots: 0, regionFill: 1 },
		});
	}

	format_time(value) {
		return value ? frappe.datetime.str_to_user(value) : "";
	}

	// ---- tasks, notes ----

	render_next_tasks() {
		const tasks = this.data.next_tasks || [];
		const $body = this.add_card(__("Next Due"));

		if (!tasks.length) {
			$body.html(this.get_empty(__("Nothing due")));
			return;
		}
		tasks.forEach(task => $body.append(this.get_task_row(task)));
	}

	get_task_row(task) {
		const time = task.requested_start_time
			? frappe.datetime.str_to_user(task.requested_start_time)
			: __("Unscheduled");
		const label = task.activity || task.description || task.name;
		return `<div class="nursing-row">
			<span class="nursing-row-time">${time}</span>
			<span class="nursing-row-label">${frappe.utils.escape_html(label)}</span>
			<span class="nursing-row-status">${__(task.status)}</span>
		</div>`;
	}

	render_last_note() {
		const note = this.data.last_note;
		const $body = this.add_card(__("Last Note"));

		if (!note) {
			$body.html(this.get_empty(__("No notes yet")));
			return;
		}
		$body.append(
			`<div class="nursing-note">${frappe.utils.html2text(
				note.note || "",
			)}</div>`,
		);
		$body.append(`<div class="nursing-note-meta">
			${frappe.utils.escape_html(note.practitioner || "")} ·
			${note.posting_date ? frappe.datetime.str_to_user(note.posting_date) : ""}
		</div>`);
	}

	render_pending() {
		const $body = this.add_card(__("Care Plan"));
		$body.html(this.get_empty(__("Care plan is not built yet")));
	}

	get_empty(message) {
		return `<div class="nursing-empty">${message}</div>`;
	}
};
