// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Diagnostic Report", {
	onload: function(frm) {
		show_observations(frm);
	},
	// validate: function(frm) {
	// 	// var selectedValue = $(this).val();

	// 	console.log("kkkkkkkkkkk", $('#result-text').val(), $(".observations").find(".result-text").val(), document.getElementById("result-text").val())
	// },
});

var show_observations = function(frm) {
	if (frm.doc.patient) {
		frm.fields_dict.observation.html("");
		const observation = new healthcare.Diagnostic.Observation({
			frm: frm,
			observation_wrapper: $(frm.fields_dict.observation.wrapper),
			create_observation: false,
		});
		observation.refresh();
	}
}
