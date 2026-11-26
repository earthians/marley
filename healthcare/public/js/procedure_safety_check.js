// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare");

healthcare.ProcedureSafetyCheck = class ProcedureSafetyCheck {
	// One checklist per procedure while the form stays open, so closing the
	// dialog to check something keeps the answers given so far.
	static for(frm, on_start) {
		if (frm.safety_check?.procedure !== frm.doc.name) {
			frm.safety_check = new ProcedureSafetyCheck(frm, on_start);
		}
		return frm.safety_check;
	}

	constructor(frm, on_start) {
		this.frm = frm;
		this.procedure = frm.doc.name;
		this.on_start = on_start;
		this.answers = {};
	}

	// Read the questions on every open, so questions changed since the last
	// open are asked, and the allergies and medications are current.
	open() {
		frappe
			.call({
				method: "healthcare.healthcare.doctype.clinical_procedure.procedure_safety_check.get_safety_questions",
				type: "GET",
				args: { procedure: this.frm.doc.name },
			})
			.then(r => {
				this.set_questions(r.message || []);
				this.questions.length ? this.show() : this.on_start(null);
			});
	}

	set_questions(questions) {
		const current = new Set(questions.map(ProcedureSafetyCheck.get_key));
		const unchanged = (this.questions || []).filter(question =>
			current.has(ProcedureSafetyCheck.get_key(question)),
		);
		this.answers = Object.fromEntries(
			unchanged
				.filter(question => this.answers[question.name])
				.map(question => [question.name, this.answers[question.name]]),
		);
		this.questions = questions;
	}

	static get_key(question) {
		return [question.name, question.question, question.answer_type].join("\n");
	}

	show() {
		this.dialog?.$wrapper.remove();
		this.dialog = new frappe.ui.Dialog({
			title: __("Safety Check"),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "checklist", options: this.get_html() },
			],
			primary_action_label: __("Start Procedure"),
			primary_action: () => {
				this.dialog.hide();
				this.on_start(this.answers);
			},
		});
		this.$checklist = this.dialog.fields_dict.checklist.$wrapper;
		this.$checklist.on("click", "[data-answer]", event =>
			this.pick($(event.currentTarget)),
		);
		this.$checklist.on("input", "input[data-question]", event =>
			this.type($(event.currentTarget)),
		);
		this.dialog.show();
		this.restore_answers();
		this.refresh_state();
		this.load_banner();
	}

	restore_answers() {
		this.$checklist.find("[data-question]").each((index, element) => {
			const $element = $(element);
			const answer = this.answers[$element.attr("data-question")];
			if (!answer) return;
			if ($element.is("input")) $element.val(answer);
			else if ($element.attr("data-answer") === answer) this.mark($element);
		});
	}

	load_banner() {
		frappe
			.xcall(healthcare.nursing.BANNER_METHOD, {
				patient: this.frm.doc.patient,
				reference_doctype: this.frm.doctype,
				reference_name: this.frm.doc.name,
			})
			.then(banner => {
				const patient = { ...banner, practitioner: null };
				this.$checklist
					.find(".nursing-banner-info")
					.html(healthcare.PatientBanner.get_patient_html(patient));
				this.render_rail_list(
					"allergies",
					banner.allergies,
					"safety-rail-allergy",
				);
			});
		frappe
			.call({
				method: "healthcare.healthcare.doctype.clinical_procedure.procedure_safety_check.get_medications",
				type: "GET",
				args: { procedure: this.frm.doc.name },
			})
			.then(r => this.render_rail_list("medications", r.message));
	}

	render_rail_list(name, items, item_class = "") {
		const rows = (items || []).map(
			item => `<li class="${item_class}">${frappe.utils.escape_html(item)}</li>`,
		);
		const empty = `<li class="text-muted">${__("None recorded")}</li>`;
		this.$checklist
			.find(`[data-rail="${name}"]`)
			.html(rows.length ? rows.join("") : empty);
	}

	get_html() {
		return `<div class="safety-check">
			<aside class="safety-rail">
				${this.get_rail_section_html(__("Allergies"), "allergies")}
				${this.get_rail_section_html(__("Current Medications"), "medications")}
			</aside>
			<div class="safety-main">
				<div class="nursing-banner">
					<div class="nursing-banner-info"></div>
				</div>
				<div class="nursing-banner">
					<div class="nursing-banner-text">
						<div class="nursing-banner-primary">
							<span class="nursing-banner-name">
								${frappe.utils.escape_html(this.frm.doc.procedure_template)}
							</span>
						</div>
						<div class="nursing-banner-facts">${this.get_procedure_facts()}</div>
					</div>
				</div>
				${this.get_sections_html()}
				<div class="safety-status"></div>
			</div>
		</div>`;
	}

	get_rail_section_html(title, name) {
		return `<div class="safety-rail-section">
			<div class="safety-section-title">${title}</div>
			<ul class="safety-rail-list" data-rail="${name}">
				<li class="text-muted">${__("Loading...")}</li>
			</ul>
		</div>`;
	}

	get_procedure_facts() {
		const doc = this.frm.doc;
		const fact = healthcare.PatientBanner.get_fact;
		const planned = [
			frappe.datetime.str_to_user(doc.start_date),
			doc.start_time?.slice(0, 5),
		];
		const facts = [];
		if (doc.practitioner_name || doc.practitioner)
			facts.push(fact(__("Doctor"), doc.practitioner_name || doc.practitioner));
		if (doc.start_date)
			facts.push(fact(__("Planned"), planned.filter(Boolean).join(" ")));
		if (doc.service_unit) facts.push(fact(__("Unit"), doc.service_unit));
		return facts.join("");
	}

	get_sections_html() {
		const sections = [...new Set(this.questions.map(question => question.section))];
		return sections
			.map(section => {
				const rows = this.questions
					.filter(question => question.section === section)
					.map(question => this.get_row_html(question));
				return `<div class="safety-section">
					<div class="safety-section-title">${frappe.utils.escape_html(__(section))}</div>
					${rows.join("")}
				</div>`;
			})
			.join("");
	}

	get_row_html(question) {
		const answer =
			question.answer_type === "Text"
				? this.get_text_html(question)
				: this.get_choices_html(question);
		return `<div class="safety-question">
			<div class="safety-question-text">${frappe.utils.escape_html(question.question)}</div>
			${answer}
		</div>`;
	}

	get_text_html(question) {
		return `<input type="text" class="form-control input-sm safety-text"
			aria-label="${frappe.utils.escape_html(question.question)}"
			data-question="${frappe.utils.escape_html(question.name)}">`;
	}

	get_choices_html(question) {
		const choices = [
			["Y", __("Yes"), "green"],
			["N", __("No"), "red"],
			["NA", __("N/A"), "gray"],
		];
		const name = frappe.utils.escape_html(question.name);
		const buttons = choices.map(
			([
				code,
				label,
				band,
			]) => `<button type="button" role="radio" aria-checked="false"
				class="safety-choice safety-choice-${band}"
				data-question="${name}" data-answer="${code}">${label}</button>`,
		);
		return `<div class="safety-choices" role="radiogroup"
			aria-label="${frappe.utils.escape_html(question.question)}">${buttons.join("")}</div>`;
	}

	pick($choice) {
		this.mark($choice);
		this.answers[$choice.attr("data-question")] = $choice.attr("data-answer");
		this.refresh_state();
	}

	mark($choice) {
		$choice.siblings().removeClass("selected").attr("aria-checked", "false");
		$choice.addClass("selected").attr("aria-checked", "true");
	}

	type($input) {
		this.answers[$input.attr("data-question")] = $input.val().trim();
		this.refresh_state();
	}

	refresh_state() {
		const answered = this.questions.filter(
			question => this.answers[question.name],
		).length;
		const has_no = this.questions.some(
			question =>
				question.answer_type !== "Text" && this.answers[question.name] === "N",
		);
		this.dialog
			.get_primary_btn()
			.prop("disabled", answered < this.questions.length || has_no);
		this.$checklist
			.find(".safety-status")
			.toggleClass("text-danger", has_no)
			.text(
				has_no
					? __("The procedure cannot start while any answer is No.")
					: __("{0} of {1} answered", [answered, this.questions.length]),
			);
	}

	static render(frm) {
		const $wrapper = frm.get_field("safety_check_html").$wrapper;
		const response = ProcedureSafetyCheck.parse(frm.doc.safety_check);
		if (!response) {
			$wrapper.empty();
			return;
		}
		const sections = response.item
			.map(ProcedureSafetyCheck.render_section)
			.join("");
		$wrapper.html(`${ProcedureSafetyCheck.render_signature(response)}${sections}`);
	}

	static parse(value) {
		if (!value) return null;
		return typeof value === "string" ? JSON.parse(value) : value;
	}

	static render_signature(response) {
		const authored = frappe.datetime.str_to_user(
			response.authored.slice(0, 19).replace("T", " "),
		);
		const message = __("Checked by {0} on {1}", [
			frappe.utils.escape_html(response.author.display),
			frappe.utils.escape_html(authored),
		]);
		return `<p class="text-muted small">${message}</p>`;
	}

	static render_section(section) {
		const rows = section.item.map(
			item => `<tr>
				<td>${frappe.utils.escape_html(item.text)}</td>
				<td>${frappe.utils.escape_html(
					ProcedureSafetyCheck.get_answer_label(item.answer[0]),
				)}</td>
			</tr>`,
		);
		return `<h6>${frappe.utils.escape_html(__(section.text))}</h6>
			<table class="table table-bordered table-sm">${rows.join("")}</table>`;
	}

	static get_answer_label(answer) {
		if (answer.valueString !== undefined) return answer.valueString;
		const labels = { Y: __("Yes"), N: __("No"), NA: __("Not Applicable") };
		return labels[answer.valueCoding.code];
	}
};
