// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.NOTE_TYPES_METHOD =
	"healthcare.healthcare.api.clinical_notes.get_note_types";
healthcare.nursing.RECORD_NOTE_METHOD =
	"healthcare.healthcare.api.clinical_notes.record_note";
healthcare.nursing.RECENT_NOTES_METHOD =
	"healthcare.healthcare.api.clinical_notes.get_recent_notes";

// F-DAR is one shape a note takes: focus first, then what was seen, what was
// done, and how the patient answered.
healthcare.nursing.FDAR_PARTS = [
	{
		fieldname: "fdar_focus",
		label: __("Focus"),
		fieldtype: "Data",
		description: __("The problem, symptom or concern this entry is about"),
	},
	{
		fieldname: "fdar_data",
		label: __("Data — what you observed"),
		fieldtype: "Small Text",
	},
	{
		fieldname: "fdar_action",
		label: __("Action — what you did"),
		fieldtype: "Small Text",
	},
	{
		fieldname: "fdar_response",
		label: __("Response — how the patient responded"),
		fieldtype: "Small Text",
	},
];

healthcare.nursing.FREE_TEXT_PART = {
	fieldname: "note",
	label: __("Note"),
	fieldtype: "Text Editor",
};

healthcare.nursing.panes.notes = class NotesPane extends healthcare.nursing.Pane {
	constructor(options) {
		super(options);
		this.controls = {};
	}

	async render() {
		this.types = await frappe.xcall(healthcare.nursing.NOTE_TYPES_METHOD);
		this.note_type = this.default_type();
		this.render_head(__("Notes"));
		this.render_form();
		await this.refresh_notes();
	}

	// F-DAR is how a nurse writes most entries, so it opens selected. If a site
	// disables it, the first type it does use takes over.
	default_type() {
		const structured = this.types.find(type => type.is_fdar);
		return (structured || this.types[0] || {}).name || null;
	}

	// The type decides the shape, so changing it rebuilds the fields.
	render_form() {
		this.controls = {};
		this.$fields.empty();
		this.$actions.empty();

		this.make_type_control();
		this.parts().forEach(part => {
			this.controls[part.fieldname] = this.make_control(part);
			this.$fields.children().last().addClass("nursing-field-wide");
		});
		this.add_button(__("Save Note"), () => this.station.commit());
	}

	make_type_control() {
		const control = this.make_control({
			fieldtype: "Select",
			fieldname: "clinical_note_type",
			label: __("Type"),
			options: this.types.map(type => type.name),
			change: () => {
				const chosen = control.get_value();
				if (chosen === this.note_type) return;

				this.note_type = chosen;
				this.render_form();
			},
		});
		control.set_value(this.note_type);
		this.$fields.children().last().addClass("nursing-field-wide");
	}

	is_fdar() {
		const type = this.types.find(candidate => candidate.name === this.note_type);
		return Boolean(type && type.is_fdar);
	}

	parts() {
		return this.is_fdar()
			? healthcare.nursing.FDAR_PARTS
			: [healthcare.nursing.FREE_TEXT_PART];
	}

	read_controls() {
		const values = {};
		this.parts().forEach(part => {
			values[part.fieldname] = this.controls[part.fieldname].get_value();
		});
		return values;
	}

	async refresh_notes() {
		this.notes = await frappe.xcall(healthcare.nursing.RECENT_NOTES_METHOD, {
			patient: this.patient,
		});
		this.render_notes();
	}

	render_notes() {
		this.render_table(
			[
				{ label: __("Note") },
				{ label: __("Type") },
				{ label: __("Written"), align: "right" },
			],
			this.notes,
			note => this.get_note_html(note),
			__("No notes yet"),
		);
	}

	get_note_html(note) {
		const heading =
			note.fdar_focus || frappe.utils.html2text(note.note || "") || __("Note");
		const detail = this.get_note_detail(note);
		return `<tr>
			<td>
				<b>${frappe.utils.escape_html(heading)}</b>
				${detail ? `<span class="sub">${frappe.utils.escape_html(detail)}</span>` : ""}
			</td>
			<td class="text-muted">${frappe.utils.escape_html(note.clinical_note_type || "")}</td>
			<td class="text-right text-muted">
				${note.posting_date ? moment(note.posting_date).format("DD/MM HH:mm") : ""}
			</td>
		</tr>`;
	}

	// The focus heads the row; the rest of the entry follows it in order, so
	// nothing a nurse wrote is dropped from the summary.
	get_note_detail(note) {
		if (!note.fdar_focus) return "";

		return healthcare.nursing.FDAR_PARTS.slice(1)
			.map(part => note[part.fieldname])
			.filter(value => value && String(value).trim())
			.join(" · ");
	}

	async save() {
		const values = this.read_controls();

		if (!Object.values(values).some(value => value && String(value).trim())) {
			frappe.throw(__("Write the note before saving"));
		}

		await frappe.xcall(healthcare.nursing.RECORD_NOTE_METHOD, {
			...this.station.get_context(),
			note_type: this.note_type,
			values: values,
		});
		this.render_form();
	}
};
