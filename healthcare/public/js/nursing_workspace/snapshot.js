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
		this.stop_waiting();
		this.$wrapper.empty().addClass(`nursing-snapshot-${this.layout}`);
		this.render_vitals();
		this.render_medications();
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
		const entries = this.get_recorded_vitals();
		const $body = this.add_card(__("Vitals"));

		if (!entries.length) {
			$body.html(this.get_empty(__("No vitals recorded yet")));
			return;
		}

		this.entry = this.get_selected_entry(entries);
		this.selected_vital = this.entry.template;
		this.render_vital_selector($body, entries);
		this.$chart_area = $(`<div class="nursing-chart"></div>`).appendTo($body);
		this.render_chart();
	}

	get_recorded_vitals() {
		return (this.data.vitals || []).filter(entry => entry.readings.length);
	}

	get_selected_entry(entries) {
		return (
			entries.find(entry => entry.template === this.selected_vital) || entries[0]
		);
	}

	render_vital_selector($body, entries) {
		const $selector = $(`<div class="nursing-vital-selector"></div>`).appendTo(
			$body,
		);

		entries.forEach(entry => {
			const selected = entry.template === this.selected_vital ? "selected" : "";
			$selector.append(`<button type="button" class="nursing-vital ${selected}"
				data-template="${frappe.utils.escape_html(entry.template)}">${__(
					entry.label,
				)}</button>`);
		});

		$selector.on("click", "[data-template]", event => {
			this.selected_vital = $(event.currentTarget).attr("data-template");
			this.render();
		});
	}

	// A pain score is a bounded rating, so it reads as bars rather than a trend line.
	is_rating() {
		return this.entry.abbr === healthcare.nursing.PAIN_SCORE_ABBR;
	}

	render_chart() {
		const readings = this.entry.readings;

		// A line needs two points, so a lone reading is shown as a value.
		if (readings.length < 2) {
			this.render_single_reading(readings[0]);
			return;
		}

		if (this.$chart_area.width() > 0) {
			this.draw_chart(readings);
			return;
		}

		// Inside a tab that is not open yet the container has no width, and the
		// chart would size itself to NaN. Wait until it is laid out.
		this.draw_when_visible(readings);
	}

	draw_when_visible(readings) {
		this.observer = new ResizeObserver(() => {
			if (this.$chart_area.width() <= 0) return;

			this.stop_waiting();
			this.draw_chart(readings);
		});
		this.observer.observe(this.$chart_area.get(0));
	}

	stop_waiting() {
		if (!this.observer) return;

		this.observer.disconnect();
		this.observer = null;
	}

	draw_chart(readings) {
		this.chart = new frappe.Chart(this.$chart_area.get(0), {
			data: {
				labels: readings.map(reading => this.format_time(reading.recorded_at)),
				datasets: [
					{
						name: this.entry.label,
						values: readings.map(reading => Number(reading.value)),
					},
				],
			},
			type: this.is_rating() ? "bar" : "line",
			height: this.layout === "rail" ? 150 : 200,
			colors: ["#318AD8"],
			axisOptions: { xIsSeries: true, xAxisMode: "tick" },
			lineOptions: { hideDots: 0, regionFill: 1 },
			barOptions: { spaceRatio: 0.4 },
			valuesOverPoints: this.is_rating() ? 1 : 0,
		});
	}

	render_single_reading(reading) {
		if (!reading) {
			this.$chart_area.html(this.get_empty(__("No readings yet")));
			return;
		}

		this.$chart_area.html(`
			<div class="nursing-reading">
				<span class="nursing-reading-value">
					${frappe.utils.escape_html(String(reading.value))}
				</span>
				<span class="nursing-reading-time">${this.format_time(reading.recorded_at)}</span>
			</div>
		`);
	}

	// Axis labels only have a few pixels each, so full timestamps collide.
	format_time(value) {
		return value ? moment(value).format("DD/MM HH:mm") : "";
	}

	// ---- medication ----

	render_medications() {
		const doses = this.data.medications || [];
		const $body = this.add_card(__("Medication Due"));

		if (!doses.length) {
			$body.html(this.get_empty(__("Nothing due")));
			return;
		}
		doses.forEach(dose => $body.append(this.get_dose_row(dose)));
	}

	get_dose_row(dose) {
		const overdue = moment(dose.scheduled_time).isBefore(moment());
		return `<div class="nursing-row">
			<span class="nursing-row-time ${overdue ? "text-danger" : ""}">
				${moment(dose.scheduled_time).format("HH:mm")}
			</span>
			<span class="nursing-row-label">
				${frappe.utils.escape_html(dose.drug_name || dose.drug_code)}
			</span>
			<span class="nursing-row-status">${format_number(dose.dosage)}</span>
		</div>`;
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
