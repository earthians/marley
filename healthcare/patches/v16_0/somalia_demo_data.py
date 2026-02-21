import frappe
from frappe.utils import nowdate, add_days, getdate, add_to_date, nowtime
import random

def execute():
    """
    Setup comprehensive demo data for Somalia Company Hospital (Misated).
    Excludes data already set up by healthcare/setup.py.
    Workflow Focus: Payment-First logic as per Somalia Hospital standard.
    """
    create_uoms()
    create_appointment_types()
    create_service_unit_types()
    create_service_units()
    create_practitioners()
    create_patients()
    create_nursing_checklists()
    create_observation_templates()
    create_lab_test_templates()
    create_procedure_templates()
    create_therapy_types()
    create_medications()
    create_radiology_templates()
    create_complaints_and_diagnoses()
    create_billing_items() # Ensure Consultation and other services are items

def create_uoms():
    """Ensure all required UOMs (standard and Lab Test) exist, aligning with healthcare/setup.py."""
    # Standard UOMs for Items
    standard_uoms = ["Nos", "ml", "Unit", "g", "mg", "Capsule", "Tablet", "Hour", "Day", "Box"]
    for uom in list(set(standard_uoms)):
        if not frappe.db.exists("UOM", uom):
            frappe.get_doc({
                "doctype": "UOM",
                "uom_name": uom
            }).insert(ignore_permissions=True)

    # Lab Test UOMs (Comprehensive list from setup.py + Extras)
    lab_uoms = [
        "umol/L", "mg/L", "mg / dl", "pg / ml", "U/ml", "/HPF", "Million Cells / cumm", 
        "Lakhs Cells / cumm", "U / L", "g / L", "IU / ml", "gm %", "Microgram", "Micron", 
        "Cells / cumm", "%", "mm / dl", "mm / hr", "ulU / ml", "ng / ml", "ng / dl", 
        "ug / dl", "g/dL", "mg/dL", "mmol/L", "10^3/uL", "10^6/uL", "IU/L", "ml", "g", 
        "Unit", "fL", "pg", "Titre", "/hpf", "cm"
    ]
    for uom in list(set(lab_uoms)):
        if not frappe.db.exists("Lab Test UOM", uom):
            frappe.get_doc({"doctype": "Lab Test UOM", "lab_test_uom": uom}).insert(ignore_permissions=True)

    # Ensure required Item Groups exist (Base)
    for group in ["Services", "Products", "Laboratory", "Medical Supplies"]:
        if not frappe.db.exists("Item Group", group):
            frappe.get_doc({
                "doctype": "Item Group",
                "item_group_name": group,
                "parent_item_group": "All Item Groups",
                "is_group": 0
            }).insert(ignore_permissions=True)
    
    # # Advanced Flow Scenarios (Payment-First)
    # create_paid_op_journey_01() # Consultation -> Payment -> Encounter -> Lab Payment -> Lab Result
    # create_paid_op_journey_02() # Pediatric Flow with Payment
    # create_paid_op_journey_03() # Gynaecology Flow with Procedure Payment
    
    # # Inpatient Scenarios
    # create_in_journey_01()
    # create_in_journey_02()
    # create_in_journey_03()

def create_billing_items():
    company = frappe.db.get_single_value('Global Defaults', 'default_company')
    items = [
        {"item_code": "Consultation", "item_name": "General Consultation Fee", "rate": 10},
        {"item_code": "Follow-up Fee", "item_name": "Follow-up Consultation", "rate": 5},
        {"item_code": "Emergency Fee", "item_name": "Emergency Consultation Fee", "rate": 15},
        {"item_code": "Nursing Fee", "item_name": "General Nursing Care", "rate": 5},
        {"item_code": "Admission Fee", "item_name": "Inpatient Admission Fee", "rate": 10},
        {"item_code": "Medical Report Fee", "item_name": "Medical Report Generation", "rate": 10},
    ]
    for i in items:
        if not frappe.db.exists("Item", i["item_code"]):
            doc = frappe.new_doc("Item")
            doc.update({
                "item_code": i["item_code"],
                "item_name": i["item_name"],
                "item_group": "Services",
                "is_stock_item": 0,
                "is_service_item": 1,
                "is_sales_item": 1,
                "stock_uom": "Nos",
                "standard_rate": i["rate"]
            })
            doc.insert(ignore_permissions=True)
            # Create standard price
            if not frappe.db.exists("Item Price", {"item_code": i["item_code"], "price_list": "Standard Selling"}):
                 price = frappe.new_doc("Item Price")
                 price.item_code = i["item_code"]
                 price.price_list = "Standard Selling"
                 price.price_list_rate = i["rate"]
                 price.insert(ignore_permissions=True)

def create_radiology_templates():
    templates = [
        {"name": "Chest X-Ray", "code": "RAD-X-CHEST", "rate": 15, "group": "X-Ray"},
        {"name": "Abdominal Ultrasound", "code": "RAD-US-ABD", "rate": 20, "group": "Ultrasound"},
        {"name": "Pelvic Ultrasound", "code": "RAD-US-PELVIC", "rate": 20, "group": "Ultrasound"},
        {"name": "Limbs X-Ray", "code": "RAD-X-LIMB", "rate": 15, "group": "X-Ray"},
        {"name": "Skull X-Ray", "code": "RAD-X-SKULL", "rate": 15, "group": "X-Ray"},
        {"name": "CT Scan Brain", "code": "RAD-CT-BRAIN", "rate": 100, "group": "CT Scan"},
    ]
    for t in templates:
        # Ensure Item Group exists
        if not frappe.db.exists("Item Group", t["group"]):
            frappe.get_doc({"doctype": "Item Group", "item_group_name": t["group"], "parent_item_group": "All Item Groups", "is_group": 0}).insert(ignore_permissions=True)

        # Create Item first
        if not frappe.db.exists("Item", t["code"]):
            item = frappe.get_doc({
                "doctype": "Item",
                "item_code": t["code"],
                "item_name": t["name"],
                "item_group": "Services",
                "is_stock_item": 0, "is_service_item": 1, "is_sales_item": 1,
                "stock_uom": "Nos",
                "standard_rate": t["rate"]
            }).insert(ignore_permissions=True)
            # Price
            if not frappe.db.exists("Item Price", {"item_code": t["code"], "price_list": "Standard Selling"}):
                frappe.get_doc({"doctype": "Item Price", "item_code": t["code"], "price_list": "Standard Selling", "price_list_rate": t["rate"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Medical Department", "Diagnostic Imaging"):
            frappe.get_doc({"doctype": "Medical Department", "department": "Diagnostic Imaging"}).insert(ignore_permissions=True)

        if not frappe.db.exists("Lab Test Template", {"lab_test_code": t["code"]}):
            doc = frappe.new_doc("Lab Test Template")
            doc.update({
                "lab_test_name": t["name"],
                "lab_test_code": t["code"],
                "item": t["code"],
                "link_existing_item": 1,
                "lab_test_group": t["group"],
                "department": "Diagnostic Imaging",
                "is_billable": 1,
                "lab_test_template_type": "Imaging",
                "lab_test_rate": t["rate"]
            })
            doc.insert(ignore_permissions=True)

def create_procedure_templates():
    create_procedure_consumables()
    
    procedures = [
        # Minor Procedures
        {
            "name": "Wound Suturing (Tolitaan nabar)", "code": "PROC-SUT", "rate": 20, "dept": "General Surgery",
            "desc": "Suturing of open wounds using sterile equipment.",
            "consumables": [{"item": "Suture Kit", "qty": 1}, {"item": "Antiseptic Solution", "qty": 0.1}]
        },
        {
            "name": "Incision & Drainage (Malax saarid)", "code": "PROC-ID", "rate": 25, "dept": "General Surgery",
            "desc": "Medical procedure to drain pus or fluid from an abscess.",
            "consumables": [{"item": "Surgical Scalpel", "qty": 1}, {"item": "Sterile Bandage", "qty": 1}]
        },
        {
            "name": "Circumcision", "code": "PROC-CIRC", "rate": 30, "dept": "Pediatrics",
            "desc": "Surgical removal of the foreskin.",
            "consumables": [{"item": "Suture Kit", "qty": 1}]
        },
        {
            "name": "Dressing Change", "code": "PROC-DRESS", "rate": 10, "dept": "Nursing",
            "desc": "Changing of wound dressings under sterile conditions.",
            "consumables": [{"item": "Sterile Bandage", "qty": 1}, {"item": "Antiseptic Solution", "qty": 0.05}]
        },

        # Maternity
        {
            "name": "Normal Delivery", "code": "MAT-ND", "rate": 150, "dept": "Gynaecology",
            "desc": "Assistance and care during normal vaginal delivery.",
            "consumables": [{"item": "Delivery Kit", "qty": 1}]
        },
        {
            "name": "C-Section", "code": "MAT-CS", "rate": 450, "dept": "Gynaecology",
            "desc": "Surgical delivery of a baby through incisions in the abdomen and uterus.",
            "pre_op": "Standard Pre-Op Checklist",
            "post_op": "Standard Post-Op Checklist",
            "consumables": [{"item": "C-Section Kit", "qty": 1}]
        },

        # Nursing Procedures
        {
            "name": "IV Fluid (Drip)", "code": "NUR-IV", "rate": 10, "dept": "Nursing",
            "desc": "Administration of intravenous fluids via a drip.",
            "consumables": [{"item": "IV Cannula 20G", "qty": 1}, {"item": "Adhesive Tape", "qty": 0.2}]
        },
        {
            "name": "Injection", "code": "NUR-INJ", "rate": 5, "dept": "Nursing",
            "desc": "Basic intramuscular or subcutaneous injection entry.",
            "consumables": [{"item": "Syringe 5ml", "qty": 1}]
        },
        {"name": "Nebulization", "code": "NUR-NEB", "rate": 10, "dept": "Nursing", "desc": "Medication administration via nebulizer."},
        {"name": "Catheter Insertion", "code": "NUR-CATH", "rate": 15, "dept": "Nursing", "desc": "Urinary catheter insertion and maintenance."}
    ]
    for p in procedures:
        if not frappe.db.exists("Item", p["code"]):
            frappe.get_doc({
                "doctype": "Item",
                "item_code": p["code"], "item_name": p["name"], "item_group": "Services",
                "is_stock_item": 0, "is_service_item": 1, "is_sales_item": 1, 
                "stock_uom": "Nos", "standard_rate": p["rate"]
            }).insert(ignore_permissions=True)
            if not frappe.db.exists("Item Price", {"item_code": p["code"], "price_list": "Standard Selling"}):
                frappe.get_doc({"doctype": "Item Price", "item_code": p["code"], "price_list": "Standard Selling", "price_list_rate": p["rate"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Medical Department", p["dept"]):
            frappe.get_doc({"doctype": "Medical Department", "department": p["dept"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Clinical Procedure Template", p["name"]):
            doc = frappe.new_doc("Clinical Procedure Template")
            doc.update({
                "template": p["name"],
                "description": p.get("desc", p["name"]),
                "item_code": p["code"],
                "item": p["code"],
                "link_existing_item": 1,
                "is_billable": 1,
                "rate": p["rate"],
                "item_group": "Services",
                "medical_department": p["dept"],
                "pre_op_nursing_checklist_template": p.get("pre_op"),
                "post_op_nursing_checklist_template": p.get("post_op"),
                "sample": p.get("sample"),
                "sample_qty": p.get("sample_qty", 1) if p.get("sample") else 0,
                "consume_stock": 1 if p.get("consumables") else 0
            })
            
            if p.get("consumables"):
                for itm in p["consumables"]:
                    doc.append("items", {
                        "item_code": itm["item"],
                        "qty": itm["qty"],
                        "uom": "Unit" if "Kit" in itm["item"] or "Scalpel" in itm["item"] or "Syringe" in itm["item"] or "Cannula" in itm["item"] else "Nos"
                    })
            
            doc.insert(ignore_permissions=True)

def create_procedure_consumables():
    items = [
        {"code": "Sterile Bandage", "group": "Medical Supplies", "uom": "Nos"},
        {"code": "Antiseptic Solution", "group": "Medical Supplies", "uom": "ml"},
        {"code": "Suture Kit", "group": "Medical Supplies", "uom": "Unit"},
        {"code": "Surgical Scalpel", "group": "Medical Supplies", "uom": "Unit"},
        {"code": "Syringe 5ml", "group": "Medical Supplies", "uom": "Unit"},
        {"code": "IV Cannula 20G", "group": "Medical Supplies", "uom": "Unit"},
        {"code": "Adhesive Tape", "group": "Medical Supplies", "uom": "Nos"},
        {"code": "Delivery Kit", "group": "Medical Supplies", "uom": "Unit"},
        {"code": "C-Section Kit", "group": "Medical Supplies", "uom": "Unit"},
    ]
    
    if not frappe.db.exists("Item Group", "Medical Supplies"):
        frappe.get_doc({"doctype": "Item Group", "item_group_name": "Medical Supplies", "parent_item_group": "Products", "is_group": 0}).insert(ignore_permissions=True)

    for i in items:
        if not frappe.db.exists("Item", i["code"]):
            frappe.get_doc({
                "doctype": "Item",
                "item_code": i["code"],
                "item_name": i["code"],
                "item_group": i["group"],
                "is_stock_item": 1,
                "stock_uom": i["uom"]
            }).insert(ignore_permissions=True)

def create_observation_templates():
    templates = [
        # Social History (Public Health focus)
        {
            "observation": "Smoking Status", "category": "Social History", "type": "Select", 
            "options": "Never smoked\nFormer smoker\nCurrent smoker\nPassive smoker", "dept": "General Medicine"
        },
        {
            "observation": "Alcohol Consumption", "category": "Social History", "type": "Select", 
            "options": "Non-drinker\nOccasional\nModerate\nHeavy", "dept": "General Medicine"
        },
        {
            "observation": "Water Source", "category": "Social History", "type": "Select", 
            "options": "Piped Water\nProtected Well\nUnprotected Well\nBottled Water", "dept": "General Medicine"
        },
        
        # Vital Signs (Advanced/Specific)
        {
            "observation": "Oxygen Saturation (SpO2)", "category": "Vital Signs", "type": "Quantity", 
            "uom": "%", "dept": "Nursing", "range": [{"low": 95, "high": 100, "label": "Normal"}]
        },
        {
            "observation": "Pain Level (VAS)", "category": "Vital Signs", "type": "Numeric", 
            "display": "Pain Scale 1-10", "dept": "Nursing"
        },
        
        # Exam / Physical Assessment
        {
            "observation": "Pupil Reactivity", "category": "Exam", "type": "Select", 
            "options": "Reactive\nSluggish\nFixed\nPinpoint", "dept": "Emergency"
        },
        {
            "observation": "Edema Status", "category": "Exam", "type": "Select", 
            "options": "None\nGrade 1+ (Mild)\nGrade 2+ (Moderate)\nGrade 3+ (Severe)\nGrade 4+ (Very Severe)", "dept": "General Medicine"
        },
        {
            "observation": "MUAC (Mid-Upper Arm)", "category": "Exam", "type": "Quantity", 
            "uom": "cm", "dept": "Pediatrics", "range": [{"low": 12.5, "high": 20.0, "label": "Normal"}, {"low": 11.5, "high": 12.5, "label": "MAM"}, {"low": 0, "high": 11.5, "label": "SAM"}]
        },

        # Laboratory (Point of Care / Rapid Tests)
        {
            "observation": "Rapid Malaria Test (RDT)", "category": "Laboratory", "type": "Select", 
            "options": "Negative\nP. falciparum Positive\nP. vivax Positive\nInvalid", "dept": "Laboratory",
            "is_billable": 1, "rate": 5, "code": "OBS-RDT-MAL"
        },
        {
            "observation": "Urine Dipstick Glucose", "category": "Laboratory", "type": "Select", 
            "options": "Negative\nTrace (+/-)\n1+ (100mg/dL)\n2+ (250mg/dL)\n3+ (500mg/dL)\n4+ (1000+mg/dL)", "dept": "Laboratory",
            "is_billable": 1, "rate": 3, "code": "OBS-UD-GLU"
        },

        # Survey / Screening
        {
            "observation": "Nutritional Status", "category": "Survey", "type": "Select", 
            "options": "Well Nourished\nModerately Malnourished\nSeverely Malnourished", "dept": "Pediatrics"
        }
    ]
    
    for t in templates:
        if not frappe.db.exists("Observation Template", t["observation"]):
            if not frappe.db.exists("Medical Department", t["dept"]):
                frappe.get_doc({"doctype": "Medical Department", "department": t["dept"]}).insert(ignore_permissions=True)

            # Handle Item for billable observations
            if t.get("is_billable") and t.get("code"):
                if not frappe.db.exists("Item", t["code"]):
                    frappe.get_doc({
                        "doctype": "Item", "item_code": t["code"], "item_name": t["observation"], 
                        "item_group": "Services", "is_stock_item": 0, "is_sales_item": 1, "standard_rate": t["rate"]
                    }).insert(ignore_permissions=True)
                    if not frappe.db.exists("Item Price", {"item_code": t["code"], "price_list": "Standard Selling"}):
                         frappe.get_doc({"doctype": "Item Price", "item_code": t["code"], "price_list": "Standard Selling", "price_list_rate": t["rate"]}).insert(ignore_permissions=True)

            doc = frappe.new_doc("Observation Template")
            doc.update({
                "observation": t["observation"],
                "observation_category": t["category"],
                "permitted_data_type": t["type"],
                "permitted_unit": t.get("uom", ""),
                "options": t.get("options", ""),
                "preferred_display_name": t.get("display", t["observation"]),
                "medical_department": t["dept"],
                "is_billable": t.get("is_billable", 0),
                "item": t.get("code", "") if t.get("is_billable") else "",
                "rate": t.get("rate", 0)
            })
            
            # Add Reference Ranges if provided
            if t.get("range"):
                for r in t["range"]:
                    doc.append("observation_reference_range", {
                        "lower_limit": r.get("low"),
                        "upper_limit": r.get("high"),
                        "assessment_label": r.get("label")
                    })
            
            doc.insert(ignore_permissions=True)

def create_nursing_checklists():
    # 1. Healthcare Activities
    activities = [
        {"name": "Vital Signs Check", "desc": "Measure BP, Temp, Pulse, SpO2", "role": "Nursing User", "doctype": "Vital Signs"},
        {"name": "Informed Consent", "desc": "Verify signed surgical consent", "role": "Nursing User", "doctype": ""},
        {"name": "Site Preparation", "desc": "Clean/Shave surgical area", "role": "Nursing User", "doctype": ""},
        {"name": "Pre-medication", "desc": "Administer prescribed pre-op drugs", "role": "Nursing User", "doctype": ""},
        {"name": "Wound Care", "desc": "Check incision site for bleeding", "role": "Nursing User", "doctype": ""},
        {"name": "Pain Assessment", "desc": "Evaluate pain levels 1-10", "role": "Nursing User", "doctype": ""},
    ]
    for act in activities:
        if not frappe.db.exists("Healthcare Activity", act["name"]):
            frappe.get_doc({
                "doctype": "Healthcare Activity",
                "activity": act["name"],
                "description": act["desc"],
                "role": act["role"],
                "task_doctype": act["doctype"]
            }).insert(ignore_permissions=True)

    # 2. Nursing Checklist Templates
    checklists = [
        {
            "title": "Standard Pre-Op Checklist",
            "dept": "Nursing",
            "tasks": [
                {"activity": "Informed Consent", "type": "Pre-Op", "mandatory": 1},
                {"activity": "Vital Signs Check", "type": "Pre-Op", "mandatory": 1},
                {"activity": "Site Preparation", "type": "Pre-Op", "mandatory": 0},
                {"activity": "Pre-medication", "type": "Pre-Op", "mandatory": 0},
            ]
        },
        {
            "title": "Standard Post-Op Checklist",
            "dept": "Nursing",
            "tasks": [
                {"activity": "Vital Signs Check", "type": "Post-Op", "mandatory": 1},
                {"activity": "Wound Care", "type": "Post-Op", "mandatory": 1},
                {"activity": "Pain Assessment", "type": "Post-Op", "mandatory": 0},
            ]
        }
    ]
    for cl in checklists:
        if not frappe.db.exists("Medical Department", cl["dept"]):
            frappe.get_doc({"doctype": "Medical Department", "department": cl["dept"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Nursing Checklist Template", cl["title"]):
            doc = frappe.new_doc("Nursing Checklist Template")
            doc.title = cl["title"]
            doc.department = cl["dept"]
            for task in cl["tasks"]:
                doc.append("tasks", task)
            doc.insert(ignore_permissions=True)

def create_appointment_types():
    types = [
        {"name": "General Checkup", "duration": 15, "color": "#3498db", "for": "Practitioner"},
        {"name": "General Consultation", "duration": 15, "color": "#3498db", "for": "Practitioner"},
        {"name": "Follow-up Visit", "duration": 10, "color": "#2ecc71", "for": "Practitioner"},
        {"name": "Emergency Visit", "duration": 20, "color": "#e74c3c", "for": "Practitioner"},
        {"name": "Medical Review", "duration": 15, "color": "#f1c40f", "for": "Practitioner"},
        {"name": "Sick Visit", "duration": 15, "color": "#9b59b6", "for": "Practitioner"},
    ]
    for t in types:
        if not frappe.db.exists("Appointment Type", t["name"]):
            doc = frappe.new_doc("Appointment Type")
            doc.appointment_type = t["name"]
            doc.default_duration = t["duration"]
            doc.color = t["color"]
            doc.allow_booking_for = t["for"]
            doc.save(ignore_permissions=True)

def create_service_unit_types():
    types = [
        {"name": "OPD Consultation Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Emergency Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Emergency Bed", "inpatient": 1, "allow_appt": 0},
        {"name": "General Ward Bed", "inpatient": 1, "allow_appt": 0},
        {"name": "Private Room Bed", "inpatient": 1, "allow_appt": 0},
        {"name": "ICU Bed", "inpatient": 1, "allow_appt": 0},
        {"name": "Maternity / Labour Room", "inpatient": 1, "allow_appt": 0},
        {"name": "Operation Theatre", "inpatient": 0, "allow_appt": 1},
        {"name": "Minor Procedure Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Recovery Room", "inpatient": 1, "allow_appt": 0},
        {"name": "Laboratory Unit", "inpatient": 0, "allow_appt": 1},
        {"name": "Sample Collection Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Radiology Unit", "inpatient": 0, "allow_appt": 1},
        {"name": "X-Ray Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Ultrasound Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Pharmacy Unit", "inpatient": 0, "allow_appt": 1},
        {"name": "Injection / Treatment Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Vaccination Room", "inpatient": 0, "allow_appt": 1},
        {"name": "Isolation Room", "inpatient": 1, "allow_appt": 0},
        {"name": "Physiotherapy Room", "inpatient": 0, "allow_appt": 1},
    ]
    for t in types:
        if not frappe.db.exists("Healthcare Service Unit Type", t["name"]):
            doc = frappe.new_doc("Healthcare Service Unit Type")
            doc.service_unit_type = t["name"]
            doc.inpatient_occupancy = t["inpatient"]
            doc.allow_appointments = t["allow_appt"]
            doc.save(ignore_permissions=True)

def create_service_units():
    company = frappe.db.get_single_value('Global Defaults', 'default_company')
    abbr = frappe.db.get_value("Company", company, "abbr")
    if not company: return
    root_name = f"All Healthcare Service Units - {abbr}"
    if not frappe.db.exists("Healthcare Service Unit", root_name):
        doc = frappe.new_doc("Healthcare Service Unit")
        doc.update({"healthcare_service_unit_name": "All Healthcare Service Units", "is_group": 1, "company": company})
        doc.insert(ignore_permissions=True)
    
    opd_label = "Outpatient Department"
    opd_name = f"{opd_label} - {abbr}"
    if not frappe.db.exists("Healthcare Service Unit", opd_name):
         doc = frappe.new_doc("Healthcare Service Unit")
         doc.update({"healthcare_service_unit_name": opd_label, "parent_healthcare_service_unit": root_name, "is_group": 1, "company": company})
         doc.insert(ignore_permissions=True)
    
    for i in range(1, 4):
        room_label = f"Consultation Room {i}"
        room_id = f"{room_label} - {abbr}"
        if not frappe.db.exists("Healthcare Service Unit", room_id):
            doc = frappe.new_doc("Healthcare Service Unit")
            doc.update({"healthcare_service_unit_name": room_label, "parent_healthcare_service_unit": opd_name, "is_group": 0, "company": company, "service_unit_type": "OPD Consultation Room"})
            doc.save(ignore_permissions=True)

def create_practitioners():
    practitioners = [
        {"first_name": "Ahmed", "last_name": "Hassan", "department": "General Surgery", "gender": "Male", "phone": "615000001"},
        {"first_name": "Fadumo", "last_name": "Ali", "department": "Pediatrics", "gender": "Female", "phone": "615000002"},
        {"first_name": "Zahra", "last_name": "Hussein", "department": "Gynaecology", "gender": "Female", "phone": "615000006"},
    ]
    for p in practitioners:
        if not frappe.db.exists("Medical Department", p["department"]):
             frappe.get_doc({"doctype": "Medical Department", "department": p["department"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Healthcare Practitioner", {"mobile_phone": p["phone"]}):
            doc = frappe.new_doc("Healthcare Practitioner")
            doc.update({"first_name": p["first_name"], "last_name": p["last_name"], "gender": p["gender"], "department": p["department"], "mobile_phone": p["phone"], "status": "Active"})
            doc.save(ignore_permissions=True)

def create_patients():
    patients = [
        {"first_name": "Ahmed", "last_name": "Mohamed", "gender": "Male", "mobile": "616000101", "dob": "1990-01-01"},
        {"first_name": "Bilal", "last_name": "Ismail", "gender": "Male", "mobile": "616000102", "dob": "2020-01-01"},
        {"first_name": "Zahra", "last_name": "Nur", "gender": "Female", "mobile": "616000103", "dob": "1995-05-15"},
    ]
    for p in patients:
        if not frappe.db.exists("Patient", {"mobile": p["mobile"]}):
            doc = frappe.new_doc("Patient")
            doc.update({"first_name": p["first_name"], "last_name": p["last_name"], "sex": p["gender"], "mobile": p["mobile"], "dob": p["dob"]})
            doc.save(ignore_permissions=True)

def create_lab_test_templates():
    # 2. Create Sample Types
    sample_types = ["Blood", "Urine", "Stool", "Sputum", "Swab"]
    for st in sample_types:
        if not frappe.db.exists("Sample Type", st):
            frappe.get_doc({"doctype": "Sample Type", "sample_type": st}).insert(ignore_permissions=True)

    # 3. Create Lab Test Samples
    samples = [
        {"name": "Whole Blood", "uom": "ml", "type": "Blood"},
        {"name": "Serum", "uom": "ml", "type": "Blood"},
        {"name": "Plasma", "uom": "ml", "type": "Blood"},
        {"name": "Urine", "uom": "ml", "type": "Urine"},
        {"name": "Stool", "uom": "g", "type": "Stool"},
        {"name": "Sputum", "uom": "ml", "type": "Sputum"},
        {"name": "Swab", "uom": "Unit", "type": "Swab"},
    ]
    for s in samples:
        if not frappe.db.exists("Lab Test Sample", s["name"]):
            frappe.get_doc({
                "doctype": "Lab Test Sample", 
                "sample": s["name"], 
                "sample_uom": s["uom"],
                "sample_type": s["type"]
            }).insert(ignore_permissions=True)

    templates = [
        # Hematology parameters (members of larger groups or single tests)
        {"name": "White Blood Cells (WBC)", "code": "WBC", "rate": 0, "group": "Laboratory", "type": "No Result", "uom": "10^3/uL", "range": "4.0 - 11.0", "sample": "Whole Blood"},
        {"name": "Red Blood Cells (RBC)", "code": "RBC", "rate": 0, "group": "Laboratory", "type": "No Result", "uom": "10^6/uL", "range": "4.5 - 5.5", "sample": "Whole Blood"},
        
        # Main Tests
        {
            "name": "Full Blood Count (FBC)", "code": "FBC", "rate": 10, "group": "Hematology", "type": "Compound", "uom": "", "range": "", "sample": "Whole Blood",
            "sub_tests": [
                {"event": "White Blood Cells (WBC)", "uom": "10^3/uL", "range": "4.0 - 11.0"},
                {"event": "Red Blood Cells (RBC)", "uom": "10^6/uL", "range": "4.5 - 5.5"},
                {"event": "Hemoglobin (Hb)", "uom": "g/dL", "range": "13.0 - 17.0"},
                {"event": "Hematocrit (HCT/PCV)", "uom": "%", "range": "40 - 50"},
                {"event": "MCV", "uom": "fL", "range": "80 - 100"},
                {"event": "Platelet Count", "uom": "10^3/uL", "range": "150 - 450"},
            ]
        },
        {"name": "Hemoglobin (Hb)", "code": "HB", "rate": 5, "group": "Hematology", "type": "Single", "uom": "g/dL", "range": "M: 13-17, F: 12-15", "sample": "Whole Blood"},
        {"name": "Blood Group & Rh", "code": "BG", "rate": 6, "group": "Hematology", "type": "Single", "uom": "", "range": "A/B/O/AB", "sample": "Whole Blood"},
        
        {
            "name": "Urine Analysis", "code": "URINE", "rate": 5, "group": "Parasitology", "type": "Compound", "uom": "", "range": "", "sample": "Urine",
            "sub_tests": [
                {"event": "Color", "uom": "", "range": "Pale Yellow"},
                {"event": "Clarity", "uom": "", "range": "Clear"},
                {"event": "pH", "uom": "", "range": "5.0 - 8.0"},
                {"event": "Glucose", "uom": "", "range": "Negative"},
                {"event": "Protein", "uom": "", "range": "Negative"},
                {"event": "WBC (Microscopic)", "uom": "/hpf", "range": "0 - 5"},
            ]
        },
        {"name": "Malaria Parasite (MP)", "code": "MP", "rate": 4, "group": "Parasitology", "type": "Single", "uom": "", "range": "Negative", "sample": "Whole Blood"},
        {"name": "Widal Test", "code": "WIDAL", "rate": 8, "group": "Serology", "type": "Compound", "uom": "Titre", "range": "< 1:160", "sample": "Serum",
            "sub_tests": [
                {"event": "S. Typhi 'O'", "uom": "Titre", "range": "< 1:80"},
                {"event": "S. Typhi 'H'", "uom": "Titre", "range": "< 1:80"},
            ]
        },
        {"name": "HIV 1 & 2", "code": "HIV", "rate": 8, "group": "Serology", "type": "Single", "uom": "", "range": "Non-Reactive", "sample": "Whole Blood"},
        
        # Biochemistry members for packages
        {"name": "Total Cholesterol", "code": "CHOL", "rate": 5, "group": "Laboratory", "type": "Single", "uom": "mg/dL", "range": "< 200", "sample": "Serum"},
        {"name": "Triglycerides", "code": "TRIG", "rate": 5, "group": "Laboratory", "type": "Single", "uom": "mg/dL", "range": "< 150", "sample": "Serum"},
        {"name": "HDL Cholesterol", "code": "HDL", "rate": 5, "group": "Laboratory", "type": "Single", "uom": "mg/dL", "range": "> 40", "sample": "Serum"},
        
        {
            "name": "Lipid Profile", "code": "LIPID", "rate": 20, "group": "Biochemistry", "type": "Grouped", "uom": "", "range": "", "sample": "Serum",
            "group_members": ["Total Cholesterol", "Triglycerides", "HDL Cholesterol"]
        },
        
        # Descriptive tests (Microbiology)
        {"name": "Urine Culture", "code": "UCULT", "rate": 15, "group": "Microbiology", "type": "Descriptive", "uom": "", "range": "", "sample": "Urine"},
        {"name": "Stool Culture", "code": "SCULT", "rate": 15, "group": "Microbiology", "type": "Descriptive", "uom": "", "range": "", "sample": "Stool"},
        
        # Package for ANC
        {
            "name": "ANC Screening Package", "code": "ANC_PKG", "rate": 25, "group": "Maternity", "type": "Grouped", "uom": "", "range": "", "sample": "Whole Blood",
            "group_members": ["HIV 1 & 2", "Hemoglobin (Hb)", "Urine Analysis", "Blood Group & Rh"]
        },
    ]
    
    # Creation Loop
    for t in templates:
        # 1. Ensure Item Group exists
        if not frappe.db.exists("Item Group", t["group"]):
            frappe.get_doc({"doctype": "Item Group", "item_group_name": t["group"], "parent_item_group": "All Item Groups", "is_group": 0}).insert(ignore_permissions=True)
        
        if not frappe.db.exists("Item Group", "Laboratory"):
            frappe.get_doc({"doctype": "Item Group", "item_group_name": "Laboratory", "parent_item_group": "All Item Groups", "is_group": 0}).insert(ignore_permissions=True)

        # 2. Create Item (except for 'No Result' components that shouldn't be billed individually)
        if t["type"] != "No Result" and not frappe.db.exists("Item", t["code"]):
            item = frappe.new_doc("Item")
            item.update({
                "item_code": t["code"], "item_name": t["name"], "item_group": "Laboratory", 
                "is_stock_item": 0, "is_service_item": 1, "is_sales_item": 1, 
                "stock_uom": "Nos", "standard_rate": t["rate"]
            })
            item.insert(ignore_permissions=True)
            if not frappe.db.exists("Item Price", {"item_code": t["code"], "price_list": "Standard Selling"}):
                frappe.get_doc({"doctype": "Item Price", "item_code": t["code"], "price_list": "Standard Selling", "price_list_rate": t["rate"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Medical Department", "Laboratory"):
            frappe.get_doc({"doctype": "Medical Department", "department": "Laboratory"}).insert(ignore_permissions=True)

        # 3. Create Lab Test Template
        if not frappe.db.exists("Lab Test Template", t["name"]):
            doc = frappe.new_doc("Lab Test Template")
            doc.update({
                "lab_test_name": t["name"], "lab_test_code": t["code"], 
                "item": t["code"] if t["type"] != "No Result" else "",
                "link_existing_item": 1 if t["type"] != "No Result" else 0,
                "lab_test_rate": t["rate"], "lab_test_group": t["group"], 
                "department": "Laboratory", "is_billable": 1 if t["type"] != "No Result" else 0,
                "lab_test_template_type": t["type"], "lab_test_uom": t["uom"],
                "lab_test_normal_range": t["range"], 
                "sample": t.get("sample"),
                "sample_qty": t.get("sample_qty", 1) if t.get("sample") else 0,
                "worksheet_instructions": "Handle sample with care. Follow standard operating procedures for analysis.",
                "result_legend": "Note: Reference ranges are provided as a guide only. Results should be interpreted by a qualified medical professional.",
                "legend_print_position": "Bottom"
            })
            
            # Sub-tests for Compound
            if t.get("sub_tests"):
                for st in t["sub_tests"]:
                    doc.append("normal_test_templates", {"lab_test_event": st["event"], "lab_test_uom": st.get("uom"), "normal_range": st.get("range")})
            
            # Members for Grouped
            if t.get("group_members"):
                for member in t["group_members"]:
                    doc.append("lab_test_groups", {"lab_test_template": member})
            
            doc.save(ignore_permissions=True)


def create_therapy_types():
    therapies = [
        {"type": "Physiotherapy Session", "code": "THER-PHY", "rate": 20, "dept": "Physiotherapy", "duration": 45},
        {"type": "Occupational Therapy", "code": "THER-OCC", "rate": 25, "dept": "Physiotherapy", "duration": 45},
        {"type": "Speech Therapy", "code": "THER-SPEECH", "rate": 30, "dept": "Pediatrics", "duration": 30},
        {"type": "Psychological Counseling", "code": "THER-PSYCH", "rate": 40, "dept": "General Medicine", "duration": 60},
    ]
    
    for t in therapies:
        if not frappe.db.exists("Medical Department", t["dept"]):
            frappe.get_doc({"doctype": "Medical Department", "department": t["dept"]}).insert(ignore_permissions=True)

        # 2. Create Therapy Type
        # Note: Therapy Type's after_insert hook automatically creates the Item and Item Price.
        # We must NOT create them manually to avoid DuplicateEntryError.
        if not frappe.db.exists("Therapy Type", t["type"]):
            # If the Item already exists (e.g. from a partially failed previous run), 
            # we must remove it so the hook can recreate it safely.
            if frappe.db.exists("Item", t["code"]):
                frappe.delete_doc("Item", t["code"], force=1, ignore_permissions=True)

            doc = frappe.new_doc("Therapy Type")
            doc.update({
                "therapy_type": t["type"],
                "item_code": t["code"],
                "item_name": t["type"],
                "item_group": "Services",
                "is_billable": 1,
                "rate": t["rate"],
                "default_duration": t["duration"],
                "medical_department": t["dept"]
            })
            doc.insert(ignore_permissions=True)
        else:
            # Ensure price list exists even if Therapy Type exists
            if not frappe.db.exists("Item Price", {"item_code": t["code"], "price_list": "Standard Selling"}):
                frappe.get_doc({
                    "doctype": "Item Price",
                    "item_code": t["code"],
                    "price_list": "Standard Selling",
                    "price_list_rate": t["rate"]
                }).insert(ignore_permissions=True)

def create_medications():
    if not frappe.db.exists("Medication Class", "General"):
        frappe.get_doc({"doctype": "Medication Class", "medication_class": "General"}).insert(ignore_permissions=True)

    meds = [{"name": "Paracetamol", "strength": 500, "uom": "mg", "form": "Tablet"}, {"name": "Amoxicillin", "strength": 250, "uom": "mg", "form": "Capsule"}]
    for med in meds:
        if not frappe.db.exists("Dosage Form", med["form"]):
            frappe.get_doc({"doctype": "Dosage Form", "dosage_form": med["form"]}).insert(ignore_permissions=True)

        if not frappe.db.exists("Item", med["name"]):
            item = frappe.new_doc("Item")
            item.update({"item_code": med["name"], "item_name": med["name"], "item_group": "Products", "is_stock_item": 1, "is_sales_item": 1, "stock_uom": med["form"], "standard_rate": 2})
            item.insert(ignore_permissions=True)
        if not frappe.db.exists("Medication", med["name"]):
            frappe.get_doc({"doctype": "Medication", "medication_name": med["name"], "item_code": med["name"], "generic_name": med["name"], "medication_class": "General", "strength": med["strength"], "strength_uom": med["uom"], "dosage_form": med["form"]}).insert(ignore_permissions=True)

def create_complaints_and_diagnoses():
    symptoms = [
        "Fever", "Cough", "Headache", "Abdominal Pain", "Chest Pain", 
        "Shortness of Breath", "Nausea", "Vomiting", "Diarrhea", 
        "Joint Pain", "Back Pain", "Skin Rash", "Fatigue", 
        "Dizziness", "Sore Throat", "Body Weakness", "Urinary Pain",
        "Loss of Appetite", "Night Sweats", "Earache", "Blurred Vision",
        "Palpitations", "Constipation", "Generalized Body Aches", "Itching",
        "Swelling (Edema)", "Numbness", "Tingling", "Heartburn", "Bloating",
        "Insomnia", "Weight Loss", "Weight Gain", "Tremors", "Muscle Spasms",
        "Excessive Thirst", "Frequent Urination", "Bloody Stool", "Bloody Urine",
        "Coughing up Blood", "Yellowish Skin (Jaundice)", "Pale Skin", 
        "Difficulty Swallowing", "Sneezing", "Runny Nose", "Nasal Congestion",
        "Hoarseness", "Mouth Ulcers", "Gum Bleeding", "Neck Pain", "Shoulder Pain",
        "Leg Cramps", "Fainting (Syncope)", "Memory Loss", "Confusion"
    ]
    for i in symptoms:
        if not frappe.db.exists("Complaint", i): 
            frappe.get_doc({"doctype": "Complaint", "complaints": i}).insert(ignore_permissions=True)
        
        # Create a basic diagnosis for each symptom if it doesn't exist
        diag_name = i if any(x in i for x in ["Pain", "Injury", "Loss", "Swelling"]) else i + " Syndrome"
        if not frappe.db.exists("Diagnosis", diag_name):
            frappe.get_doc({"doctype": "Diagnosis", "diagnosis": diag_name}).insert(ignore_permissions=True)

    # Add some specific common clinical diagnoses
    clinical_diagnoses = [
        "Malaria", "Typhoid Fever", "Upper Respiratory Tract Infection", 
        "Gastroenteritis", "Hypertension", "Diabetes Mellitus Type 2", 
        "Anemia", "Pneumonia", "Amoebiasis", "Giardiasis", "Asthma",
        "Bronchitis", "Urinary Tract Infection", "Osteoarthritis", 
        "Rheumatoid Arthritis", "Peptic Ulcer Disease", "GERD", "Migraine",
        "Tonsillitis", "Sinusitis", "Otitis Media", "Conjunctivitis",
        "Dermatitis", "Scabies", "Helminthiasis (Worms)"
    ]
    for d in clinical_diagnoses:
        if not frappe.db.exists("Diagnosis", d):
            frappe.get_doc({"doctype": "Diagnosis", "diagnosis": d}).insert(ignore_permissions=True)

# --- PAYMENT HELPERS ---

def create_paid_invoice(patient, company, items, healthcare_doc=None):
    """Creates a paid Sales Invoice for given items linked to a healthcare doc."""
    customer = frappe.get_value("Patient", patient, "customer")
    if not customer:
        customer = frappe.db.get_value("Patient", patient, "name") # Fallback to patient name if no customer linked

    si = frappe.new_doc("Sales Invoice")
    si.update({"customer": customer, "company": company, "posting_date": nowdate(), "status": "Draft"})
    
    total_amount = 0
    for itm in items:
        si.append("items", {"item_code": itm["code"], "qty": 1, "rate": itm["rate"]})
        total_amount += itm["rate"]

    si.insert(ignore_permissions=True)
    si.submit()
    
    # Create Payment Entry to mark as paid
    pe = frappe.new_doc("Payment Entry")
    pe.update({
        "payment_type": "Receive",
        "party_type": "Customer",
        "party": customer,
        "paid_amount": total_amount,
        "received_amount": total_amount,
        "target_exchange_rate": 1.0,
        "company": company,
        "posting_date": nowdate()
    })
    pe.append("references", {"reference_doctype": "Sales Invoice", "reference_name": si.name, "total_amount": total_amount, "outstanding_amount": total_amount, "allocated_amount": total_amount})
    pe.insert(ignore_permissions=True)
    pe.submit()
    
    return si.name

# --- REFINED JOURNEYS (Somalia Workflow: Pay -> Step) ---

def create_paid_op_journey_01():
    """Ahmed Mohamed: Appt -> PAY Consultation -> Encounter -> Prescribe Lab -> PAY Lab -> Result."""
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "Misated Hospital"
    patient = frappe.get_all("Patient", filters={"mobile": "616000101"}, limit=1)[0].name
    practitioner = get_practitioner_by_dept("General Surgery")
    date = nowdate()

    # Step 1: Appointment
    appt = frappe.new_doc("Patient Appointment")
    appt.update({"patient": patient, "practitioner": practitioner, "appointment_date": date, "appointment_time": nowtime(), "status": "Open", "company": company, "appointment_type": "General Checkup"})
    appt.insert(ignore_permissions=True)

    # Step 2: Payment for Consultation (STRICT: MUST PAY BEFORE SEEING DOCTOR)
    inv = create_paid_invoice(patient, company, [{"code": "Consultation", "rate": 10}], appt.name)
    frappe.db.set_value("Patient Appointment", appt.name, {"invoiced": 1, "ref_sales_invoice": inv, "status": "Confirmed"})

    # Step 3: Encounter
    enc = frappe.new_doc("Patient Encounter")
    enc.update({"patient": patient, "practitioner": practitioner, "appointment": appt.name, "encounter_date": date, "company": company})
    enc.append("symptoms", {"complaint": "Fever"})
    enc.append("diagnosis", {"diagnosis": "Fever Syndrome"})
    enc.append("lab_test_prescription", {"lab_test_code": "MP", "lab_test_name": "Malaria Parasite"})
    enc.insert(ignore_permissions=True)
    enc.submit()

    # Step 4: Payment for Prescribed Services (STRICT: MUST PAY BEFORE LAB)
    lab_inv = create_paid_invoice(patient, company, [{"code": "MP", "rate": 5}], enc.name)

    # Step 5: Perform Lab Test (After Payment)
    lt = frappe.new_doc("Lab Test")
    lt.update({"patient": patient, "practitioner": practitioner, "template": "Malaria Parasite", "date": date, "time": nowtime(), "company": company, "status": "Completed", "invoiced": 1})
    lt.insert(ignore_permissions=True)
    lt.submit()

    print("Paid OP Journey 1 (Ahmed Mohamed) Completed.")

def create_paid_op_journey_02():
    """Bilal Ismail: PAY -> Pediatric Encounter -> PAY Meds."""
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "Misated Hospital"
    patient = frappe.get_all("Patient", filters={"mobile": "616000102"}, limit=1)[0].name
    practitioner = get_practitioner_by_dept("Pediatrics")
    date = nowdate()

    # Appt & Paid
    appt = frappe.new_doc("Patient Appointment")
    appt.update({"patient": patient, "practitioner": practitioner, "appointment_date": date, "appointment_time": nowtime(), "status": "Confirmed", "company": company, "appointment_type": "General Checkup", "invoiced": 1})
    appt.insert(ignore_permissions=True)
    create_paid_invoice(patient, company, [{"code": "Consultation", "rate": 10}])

    # Encounter
    enc = frappe.new_doc("Patient Encounter")
    enc.update({"patient": patient, "practitioner": practitioner, "appointment": appt.name, "encounter_date": date, "company": company})
    enc.append("drug_prescription", {"medication": "Paracetamol", "dosage": "1-1-1", "period": "3 Day"})
    enc.insert(ignore_permissions=True)
    enc.submit()

    # Meds Payment
    create_paid_invoice(patient, company, [{"code": "Paracetamol", "rate": 2}])
    print("Paid OP Journey 2 (Bilal) Completed.")

def create_paid_op_journey_03():
    """Zahra Nur: PAY -> Encounter -> Prescribe Procedure -> PAY -> Complete Procedure."""
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "Misated Hospital"
    patient = frappe.get_all("Patient", filters={"mobile": "616000103"}, limit=1)[0].name
    practitioner = get_practitioner_by_dept("Gynaecology")
    date = nowdate()

    # Paid Checkup
    create_paid_invoice(patient, company, [{"code": "Consultation", "rate": 10}])
    
    enc = frappe.new_doc("Patient Encounter")
    enc.update({"patient": patient, "practitioner": practitioner, "encounter_date": date, "company": company, "appointment_type": "General Consultation"})
    enc.append("procedure_prescription", {"procedure": "Dressing Change", "date": date})
    enc.insert(ignore_permissions=True)
    enc.submit()

    # Procedure Payment
    create_paid_invoice(patient, company, [{"code": "PROC-DRESS", "rate": 10}])

    # Step 4: Perform Procedure (Transactional)
    proc = frappe.new_doc("Clinical Procedure")
    proc.update({
        "patient": patient,
        "practitioner": practitioner,
        "procedure_template": "Wound Dressing",
        "start_date": date,
        "start_time": nowtime(),
        "company": company,
        "status": "Completed",
        "invoiced": 1
    })
    proc.insert(ignore_permissions=True)
    proc.submit()

    print("Paid OP Journey 3 (Zahra) Completed with Workflow Procedure.")

# --- INPATIENT JOURNEYS ---

def create_in_journey_01():
    """Omar Ali: Admission -> Minor Surgery with Checklists -> Discharge."""
    company = frappe.db.get_single_value('Global Defaults', 'default_company') or "Misated Hospital"
    patient = frappe.get_all("Patient", filters={"mobile": "616000104"}, limit=1)[0].name
    practitioner = get_practitioner_by_dept("General Surgery")
    date = nowdate()

    # 1. Pay Admission & Surgery upfront
    items = [
        {"code": "Consultation", "rate": 15},
        {"code": "Admission Fee", "rate": 10},
        {"code": "PROC-MINOR", "rate": 50}
    ]
    create_paid_invoice(patient, company, items)

    # 2. IP Admission
    inpatient_record = frappe.new_doc("Inpatient Record")
    inpatient_record.update({
        "patient": patient,
        "company": company,
        "expected_admission_date": date,
        "status": "Admitted",
        "admission_practitioner": practitioner
    })
    inpatient_record.insert(ignore_permissions=True)

    # 3. Create Surgery (Clinical Procedure)
    surgery = frappe.new_doc("Clinical Procedure")
    surgery.update({
        "patient": patient,
        "practitioner": practitioner,
        "procedure_template": "Minor Surgery",
        "start_date": date,
        "start_time": nowtime(),
        "company": company,
        "status": "In Progress",
        "invoiced": 1,
        "inpatient_record": inpatient_record.name,
        "consume_stock": 0
    })
    surgery.insert(ignore_permissions=True)

    # 4. Handle Nursing Checklist Tasks (Simulate completion)
    tasks = frappe.get_all("Nursing Task", filters={"reference_name": surgery.name})
    for task in tasks:
        frappe.db.set_value("Nursing Task", task.name, {"status": "Completed", "completed_by": frappe.session.user, "completed_at": nowtime()})

    surgery.status = "Completed"
    surgery.save(ignore_permissions=True)
    surgery.submit()

    print("Inpatient Journey 1 (Omar - Minor Surgery) Completed.")

# --- UTILS ---
def get_practitioner_by_dept(dept):
    p = frappe.get_all("Healthcare Practitioner", filters={"department": dept}, limit=1)
    if p: return p[0].name
    return frappe.get_all("Healthcare Practitioner", limit=1)[0].name

def create_in_journey_02(): pass
def create_in_journey_03(): pass
def create_appointments_and_encounters(): pass
