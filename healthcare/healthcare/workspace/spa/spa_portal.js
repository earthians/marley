frappe.pages['spa-portal'].on_page_load = function(wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Spa Portal',
		single_column: true
	});

	const style = `
		<style>
			.spa-wrapper {
				padding: 20px;
				max-width: 1400px;
				margin: 0 auto;
			}

			.tabs-section {
				display: flex;
				gap: 10px;
				margin-bottom: 20px;
				border-bottom: 2px solid #e0e0e0;
				padding-bottom: 0;
				align-items: center;
			}

			.tab-btn {
				padding: 12px 24px;
				background: transparent;
				border: none;
				border-bottom: 3px solid transparent;
				color: #6c757d;
				font-weight: 600;
				font-size: 1rem;
				cursor: pointer;
				transition: all 0.3s ease;
				position: relative;
				bottom: -2px;
			}

			.tab-btn:hover { color: var(--primary-color); }
			.tab-btn.active { color: var(--primary-color); border-bottom-color: var(--primary-color); }

			.tab-content { display: none; }
			.tab-content.active { display: block; }

			/* Create Invoice Form */
			.create-invoice-section {
				background: white;
				border: 1px solid #d1d8dd;
				border-radius: 12px;
				padding: 25px;
				box-shadow: 0 2px 8px rgba(0,0,0,0.08);
			}

			.customer-toggle-row {
				display: flex;
				gap: 15px;
				align-items: end;
				margin-bottom: 20px;
			}

			.toggle-group {
				display: flex;
				gap: 0;
				border: 1px solid #e0e0e0;
				border-radius: 8px;
				overflow: hidden;
				width: fit-content;
				height: fit-content;
				align-self: center;
			}

			.toggle-btn {
				padding: 10px 24px;
				background: #f8f9fa;
				border: none;
				color: #6c757d;
				font-weight: 600;
				font-size: 0.95rem;
				cursor: pointer;
				transition: all 0.3s ease;
			}

			.toggle-btn:hover { background: #e9ecef; }
			.toggle-btn.active {
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				color: white;
			}

			.customer-patient-field { min-width: 300px; }
			.customer-patient-field .frappe-control { margin-bottom: 0; }

			.posting-date-field { min-width: 180px; }
			.posting-date-field .frappe-control { margin-bottom: 0; }

			/* Spa Services Table */
			.spa-services-section { margin-bottom: 20px; }
			.spa-services-section h5 { font-weight: 600; margin-bottom: 10px; color: #495057; }

			.spa-services-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 10px;
			}

			.spa-services-table-wrapper {
				border: 1px solid #d1d8dd;
				border-radius: 8px;
				overflow: visible;
				position: relative;
			}

			.spa-services-table { width: 100%; border-collapse: collapse; }
			.spa-services-table thead { background: #f8f9fa; }

			.spa-services-table th {
				padding: 10px 12px;
				text-align: left;
				font-weight: 600;
				font-size: 0.85rem;
				color: #495057;
				border-bottom: 2px solid #d1d8dd;
			}

			.spa-services-table td {
				padding: 10px 12px;
				font-size: 0.9rem;
				border-bottom: 1px solid #e9ecef;
			}

			.spa-services-table tbody tr:hover { background: #f8f9fa; }

			.spa-services-table .service-checkbox { width: 18px; height: 18px; cursor: pointer; }

			.spa-services-table .qty-input {
				width: 60px;
				text-align: center;
				border: 1px solid #d1d8dd;
				border-radius: 4px;
				padding: 4px 6px;
				font-size: 0.9rem;
			}

			.spa-services-table .qty-input:focus {
				outline: none;
				border-color: #667eea;
				box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
			}

			.add-service-row {
				display: flex;
				gap: 10px;
				align-items: end;
				padding: 12px;
				background: #f8f9fa;
				border-top: 1px solid #e9ecef;
			}

			.add-service-row .frappe-control { flex: 1; margin-bottom: 0; }
			.add-service-row .form-group { margin-bottom: 0; }

			.spa-total-row {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				gap: 15px;
				margin-top: 15px;
				padding: 15px 20px;
				background: #f8f9fa;
				border-radius: 8px;
				border: 1px solid #d1d8dd;
			}

			.spa-total-label { font-size: 1.1rem; font-weight: 600; color: #495057; }
			.spa-total-value { font-size: 1.3rem; font-weight: 700; color: #28a745; }

			.btn-delete-selected {
				background: #dc3545; color: white; border: none;
				padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;
			}
			.btn-delete-selected:hover { background: #c82333; }

			.no-services-msg { text-align: center; padding: 20px; color: #6c757d; font-style: italic; }

			/* Filter Bar */
			.filter-bar {
				display: flex;
				gap: 15px;
				margin-bottom: 20px;
				padding: 15px;
				background: #f8f9fa;
				border-radius: 8px;
				align-items: end;
			}

			.filter-bar .frappe-control { flex: 1; margin-bottom: 0; }
			.filter-bar .form-group { margin-bottom: 0; }

			/* Summary Stats */
			.summary-stats {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 15px;
				margin-bottom: 20px;
			}

			.stat-box {
				background: white;
				border: 1px solid #d1d8dd;
				border-radius: 12px;
				padding: 20px;
				text-align: center;
				box-shadow: 0 2px 8px rgba(0,0,0,0.08);
			}

			.stat-box .stat-label { font-size: 0.85rem; color: #6c757d; margin-bottom: 8px; font-weight: 500; }
			.stat-box .stat-value { font-size: 1.5rem; font-weight: 700; color: #2c3e50; }
			.stat-box.stat-green .stat-value { color: #28a745; }
			.stat-box.stat-orange .stat-value { color: #fd7e14; }

			/* Invoice Table */
			.invoices-table-container {
				background: white; border-radius: 8px; overflow: hidden;
				box-shadow: 0 2px 8px rgba(0,0,0,0.08);
			}

			.invoices-table { width: 100%; border-collapse: collapse; }
			.invoices-table thead { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
			.invoices-table th { padding: 12px; text-align: left; font-weight: 600; font-size: 0.9rem; }

			.invoices-table tbody tr.invoice-row {
				border-bottom: 1px solid #e9ecef; cursor: pointer; transition: background 0.2s ease;
			}
			.invoices-table tbody tr.invoice-row:hover { background: #f8f9fa; }
			.invoices-table td { padding: 12px; font-size: 0.9rem; }

			.invoice-toggle-icon { transition: transform 0.2s ease; margin-right: 8px; color: #6c757d; }
			.invoice-toggle-icon.expanded { transform: rotate(90deg); }

			.invoice-items-row { display: none; }
			.invoice-items-row.expanded { display: table-row; }
			.invoice-items-row td { padding: 0 12px 12px 40px; background: #f8f9fa; }

			.invoice-items-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
			.invoice-items-table th {
				padding: 8px 10px; text-align: left; font-weight: 600;
				color: #495057; background: #e9ecef; font-size: 0.8rem;
			}
			.invoice-items-table td { padding: 8px 10px; border-bottom: 1px solid #e9ecef; }

			/* Badges */
			.badge-success { background: #d4edda; color: #155724; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
			.badge-warning { background: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
			.badge-danger { background: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
			.badge-info { background: #d1ecf1; color: #0c5460; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
			.badge-secondary { background: #e2e3e5; color: #383d41; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }

			/* Bookings */
			.bookings-section {
				background: white; border: 1px solid #d1d8dd; border-radius: 12px;
				padding: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 20px;
			}

			.bookings-section h5 { font-weight: 600; margin-bottom: 15px; color: #495057; }

			.booking-form-grid {
				display: grid;
				grid-template-columns: 1fr 1fr 1fr;
				gap: 15px;
				margin-bottom: 15px;
			}

			.booking-form-grid .frappe-control { margin-bottom: 0; }
			.booking-form-grid .form-group { margin-bottom: 0; }

			.booking-form-row2 {
				display: grid;
				grid-template-columns: 1fr 1fr 1fr;
				gap: 15px;
				margin-bottom: 15px;
			}

			.booking-form-row2 .frappe-control { margin-bottom: 0; }
			.booking-form-row2 .form-group { margin-bottom: 0; }

			.booking-notes-row { margin-bottom: 15px; }
			.booking-notes-row .frappe-control { margin-bottom: 0; }
			.booking-notes-row .form-group { margin-bottom: 0; }

			.bookings-view-toggle {
				display: flex;
				gap: 0;
				border: 1px solid #e0e0e0;
				border-radius: 8px;
				overflow: hidden;
				width: fit-content;
				margin-bottom: 15px;
			}

			.view-toggle-btn {
				padding: 8px 20px;
				background: #f8f9fa;
				border: none;
				color: #6c757d;
				font-weight: 600;
				font-size: 0.9rem;
				cursor: pointer;
				transition: all 0.3s ease;
			}

			.view-toggle-btn:hover { background: #e9ecef; }
			.view-toggle-btn.active {
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				color: white;
			}

			.bookings-list-container {
				background: white; border-radius: 8px; overflow: hidden;
				box-shadow: 0 2px 8px rgba(0,0,0,0.08);
			}

			.bookings-table { width: 100%; border-collapse: collapse; }
			.bookings-table thead { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
			.bookings-table th { padding: 12px; text-align: left; font-weight: 600; font-size: 0.9rem; }
			.bookings-table td { padding: 12px; font-size: 0.9rem; border-bottom: 1px solid #e9ecef; }
			.bookings-table tbody tr:hover { background: #f8f9fa; }

			.booking-status-select {
				padding: 4px 8px;
				border: 1px solid #d1d8dd;
				border-radius: 4px;
				font-size: 0.8rem;
				font-weight: 600;
				cursor: pointer;
			}

			/* Calendar */
			.spa-calendar { margin-top: 15px; }

			.cal-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 15px;
			}

			.cal-header h5 { margin: 0; font-weight: 600; color: #495057; }

			.cal-nav-btn {
				background: #f8f9fa; border: 1px solid #d1d8dd; border-radius: 4px;
				padding: 6px 12px; cursor: pointer; font-weight: 600; color: #495057;
			}
			.cal-nav-btn:hover { background: #e9ecef; }

			.cal-grid {
				display: grid;
				grid-template-columns: repeat(7, 1fr);
				border: 1px solid #d1d8dd;
				border-radius: 8px;
				overflow: hidden;
			}

			.cal-day-header {
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				color: white;
				padding: 10px 5px;
				text-align: center;
				font-weight: 600;
				font-size: 0.85rem;
			}

			.cal-day {
				min-height: 100px;
				padding: 5px;
				border: 1px solid #e9ecef;
				background: white;
				vertical-align: top;
				font-size: 0.8rem;
			}

			.cal-day.other-month { background: #f8f9fa; color: #adb5bd; }
			.cal-day.today { background: #eef2ff; }

			.cal-day-num {
				font-weight: 600;
				font-size: 0.85rem;
				margin-bottom: 4px;
				color: #495057;
			}

			.cal-day.other-month .cal-day-num { color: #adb5bd; }
			.cal-day.today .cal-day-num { color: #667eea; }

			.cal-event {
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				color: white;
				padding: 2px 6px;
				border-radius: 4px;
				margin-bottom: 3px;
				font-size: 0.7rem;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				cursor: pointer;
			}

			.cal-event:hover { opacity: 0.9; }

			.cal-event.status-completed { background: #28a745; }
			.cal-event.status-cancelled { background: #dc3545; }
			.cal-event.status-no-show { background: #6c757d; }

			.empty-state {
				text-align: center; padding: 60px 20px; color: #6c757d;
			}
			.empty-state i { font-size: 64px; margin-bottom: 20px; opacity: 0.3; }
			.empty-state h4 { font-size: 1.3rem; margin-bottom: 10px; color: #495057; }
			.empty-state p { font-size: 1rem; margin: 0; }

			@media (max-width: 768px) {
				.spa-wrapper { padding: 15px; }
				.summary-stats { grid-template-columns: 1fr; }
				.booking-form-grid, .booking-form-row2 { grid-template-columns: 1fr; }
				.customer-toggle-row { flex-wrap: wrap; }
				.tabs-section { overflow-x: auto; flex-wrap: wrap; }
			}
		</style>
	`;

	$(style).appendTo(page.main);

	let html = `
		<div class="spa-wrapper">
			<div class="tabs-section">
				<button class="tab-btn active" data-tab="create">
					<i class="fa fa-plus-circle"></i> Create Invoice
				</button>
				<button class="tab-btn" data-tab="invoices">
					<i class="fa fa-list"></i> Invoices
				</button>
				<button class="tab-btn" data-tab="bookings">
					<i class="fa fa-calendar"></i> Bookings
				</button>
			</div>

			<!-- Tab 1: Create Invoice -->
			<div class="tab-content active" id="create-tab">
				<div class="create-invoice-section">
					<div class="customer-toggle-row">
						<div class="toggle-group">
							<button class="toggle-btn active" data-mode="customer">Customer</button>
							<button class="toggle-btn" data-mode="patient">Patient</button>
						</div>
						<div class="customer-patient-field">
							<div data-fieldname="customer_field"></div>
							<div data-fieldname="patient_field" style="display: none;"></div>
						</div>
						<div class="posting-date-field">
							<div data-fieldname="posting_date_field"></div>
						</div>
					</div>
					<div class="spa-services-section">
						<div class="spa-services-header">
							<h5><i class="fa fa-list-ul"></i> Spa Services</h5>
							<button class="btn btn-delete-selected" id="delete-selected-btn" style="display: none;">
								<i class="fa fa-trash"></i> Delete Selected
							</button>
						</div>
						<div class="spa-services-table-wrapper">
							<table class="spa-services-table">
								<thead>
									<tr>
										<th style="width: 40px;">
											<input type="checkbox" class="service-checkbox" id="select-all-services">
										</th>
										<th>#</th>
										<th>Spa Type</th>
										<th style="text-align: center; width: 80px;">Qty</th>
										<th style="text-align: right;">Rate</th>
										<th style="text-align: right;">Amount</th>
										<th style="width: 40px;"></th>
									</tr>
								</thead>
								<tbody id="services-tbody"></tbody>
							</table>
							<div class="no-services-msg" id="no-services-msg">
								No services added yet. Select a spa type below to add.
							</div>
							<div class="add-service-row">
								<div data-fieldname="add_spa_type_field"></div>
								<button class="btn btn-primary btn-sm" id="add-service-btn">
									<i class="fa fa-plus"></i> Add
								</button>
							</div>
						</div>
						<div class="spa-total-row">
							<span class="spa-total-label">Total Amount:</span>
							<span class="spa-total-value" id="spa-total-value">${format_currency(0)}</span>
						</div>
					</div>
					<button class="btn btn-success btn-lg" id="create-invoice-btn">
						<i class="fa fa-check"></i> Create Invoice
					</button>
				</div>
			</div>

			<!-- Tab 2: Invoices -->
			<div class="tab-content" id="invoices-tab">
				<div class="filter-bar">
					<div data-fieldname="filter_date"></div>
					<button class="btn btn-primary" id="filter-btn">
						<i class="fa fa-filter"></i> Filter
					</button>
				</div>
				<div class="summary-stats" id="summary-stats"></div>
				<div class="invoices-table-container" id="invoices-table-container"></div>
			</div>

			<!-- Tab 3: Bookings -->
			<div class="tab-content" id="bookings-tab">
				<div class="bookings-section">
					<h5><i class="fa fa-plus-circle"></i> New Booking</h5>
					<div class="booking-form-grid">
						<div data-fieldname="bk_client_name"></div>
						<div data-fieldname="bk_phone"></div>
						<div data-fieldname="bk_spa_type"></div>
					</div>
					<div class="booking-form-row2">
						<div data-fieldname="bk_date"></div>
						<div data-fieldname="bk_time"></div>
						<div data-fieldname="bk_notes"></div>
					</div>
					<button class="btn btn-success" id="create-booking-btn">
						<i class="fa fa-calendar-plus-o"></i> Create Booking
					</button>
				</div>

				<div class="bookings-view-toggle">
					<button class="view-toggle-btn active" data-view="list">
						<i class="fa fa-list"></i> List
					</button>
					<button class="view-toggle-btn" data-view="calendar">
						<i class="fa fa-calendar"></i> Calendar
					</button>
				</div>

				<!-- List View -->
				<div id="bookings-list-view">
					<div class="filter-bar">
						<div data-fieldname="bk_filter_date"></div>
						<button class="btn btn-primary" id="bk-filter-btn">
							<i class="fa fa-filter"></i> Filter
						</button>
					</div>
					<div class="bookings-list-container" id="bookings-list-container"></div>
				</div>

				<!-- Calendar View -->
				<div id="bookings-calendar-view" style="display: none;">
					<div class="spa-calendar" id="spa-calendar"></div>
				</div>
			</div>
		</div>
	`;

	$(html).appendTo(page.main);

	// =============================================
	// STATE
	// =============================================
	let currentMode = 'customer';
	let spaServices = [];
	let calYear, calMonth;
	const now = new Date();
	calYear = now.getFullYear();
	calMonth = now.getMonth();

	// =============================================
	// CONTROLS — Create Invoice Tab
	// =============================================
	let customer_field = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="customer_field"]'),
		df: { fieldtype: 'Link', fieldname: 'customer_field', options: 'Customer', label: 'Customer', placeholder: 'Select Customer' },
		render_input: true
	});
	customer_field.refresh();

	let patient_field = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="patient_field"]'),
		df: { fieldtype: 'Link', fieldname: 'patient_field', options: 'Patient', label: 'Patient', placeholder: 'Select Patient' },
		render_input: true
	});
	patient_field.refresh();

	let posting_date_field = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="posting_date_field"]'),
		df: { fieldtype: 'Date', fieldname: 'posting_date_field', label: 'Posting Date', default: frappe.datetime.get_today() },
		render_input: true
	});
	posting_date_field.refresh();
	posting_date_field.set_value(frappe.datetime.get_today());

	let add_spa_type_field = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="add_spa_type_field"]'),
		df: {
			fieldtype: 'Link', fieldname: 'add_spa_type_field', options: 'Spa Type',
			label: 'Select Spa Type', placeholder: 'Search spa service...',
			get_query: function() { return { filters: { enabled: 1 } }; }
		},
		render_input: true
	});
	add_spa_type_field.refresh();

	// =============================================
	// CONTROLS — Invoices Tab
	// =============================================
	let filter_date = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="filter_date"]'),
		df: {
			fieldtype: 'Date', fieldname: 'filter_date', label: 'Date',
			default: frappe.datetime.get_today(),
			onchange: function() {
				if (page.main.find('#invoices-tab').hasClass('active')) loadInvoices();
			}
		},
		render_input: true
	});
	filter_date.refresh();
	filter_date.set_value(frappe.datetime.get_today());

	// =============================================
	// CONTROLS — Bookings Tab
	// =============================================
	let bk_client_name = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_client_name"]'),
		df: { fieldtype: 'Data', fieldname: 'bk_client_name', label: 'Client Name', placeholder: 'Full name', reqd: 1 },
		render_input: true
	});
	bk_client_name.refresh();

	let bk_phone = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_phone"]'),
		df: { fieldtype: 'Data', fieldname: 'bk_phone', label: 'Phone', placeholder: 'Phone number', options: 'Phone', reqd: 1 },
		render_input: true
	});
	bk_phone.refresh();

	let bk_spa_type = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_spa_type"]'),
		df: {
			fieldtype: 'Link', fieldname: 'bk_spa_type', options: 'Spa Type', label: 'Spa Type',
			placeholder: 'Select service', reqd: 1,
			get_query: function() { return { filters: { enabled: 1 } }; }
		},
		render_input: true
	});
	bk_spa_type.refresh();

	let bk_date = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_date"]'),
		df: { fieldtype: 'Date', fieldname: 'bk_date', label: 'Booking Date', default: frappe.datetime.get_today(), reqd: 1 },
		render_input: true
	});
	bk_date.refresh();
	bk_date.set_value(frappe.datetime.get_today());

	let bk_time = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_time"]'),
		df: { fieldtype: 'Time', fieldname: 'bk_time', label: 'Booking Time', reqd: 1 },
		render_input: true
	});
	bk_time.refresh();

	let bk_notes = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_notes"]'),
		df: { fieldtype: 'Data', fieldname: 'bk_notes', label: 'Notes', placeholder: 'Optional notes...' },
		render_input: true
	});
	bk_notes.refresh();

	let bk_filter_date = frappe.ui.form.make_control({
		parent: page.main.find('[data-fieldname="bk_filter_date"]'),
		df: {
			fieldtype: 'Date', fieldname: 'bk_filter_date', label: 'Date',
			default: frappe.datetime.get_today(),
			onchange: function() {
				if (page.main.find('#bookings-list-view').is(':visible')) loadBookingsList();
			}
		},
		render_input: true
	});
	bk_filter_date.refresh();
	bk_filter_date.set_value(frappe.datetime.get_today());

	// =============================================
	// SERVICES TABLE LOGIC
	// =============================================
	function addService(spa_type_name) {
		if (!spa_type_name) return;
		const existing = spaServices.find(s => s.spa_type === spa_type_name);
		if (existing) {
			frappe.show_alert({ message: __('"{0}" has already been added', [existing.spa_type_name]), indicator: 'orange' }, 5);
			add_spa_type_field.set_value('');
			return;
		}
		frappe.db.get_value('Spa Type', spa_type_name, ['rate', 'spa_type_name'], (r) => {
			if (r) {
				const rate = r.rate || 0;
				spaServices.push({ spa_type: spa_type_name, spa_type_name: r.spa_type_name || spa_type_name, qty: 1, rate: rate, amount: rate, checked: false });
				renderServicesTable();
				add_spa_type_field.set_value('');
			}
		});
	}

	function removeServicesByIndices(indices) {
		spaServices = spaServices.filter((_, i) => !indices.includes(i));
		renderServicesTable();
	}

	function updateTotal() {
		let total = 0;
		spaServices.forEach(s => { total += s.amount; });
		page.main.find('#spa-total-value').text(format_currency(total));
	}

	function renderServicesTable() {
		const tbody = page.main.find('#services-tbody');
		const noMsg = page.main.find('#no-services-msg');
		tbody.empty();
		if (!spaServices.length) {
			noMsg.show();
			page.main.find('#delete-selected-btn').hide();
			page.main.find('#select-all-services').prop('checked', false);
			updateTotal();
			return;
		}
		noMsg.hide();
		spaServices.forEach(function(service, idx) {
			tbody.append(`
				<tr data-idx="${idx}">
					<td><input type="checkbox" class="service-checkbox service-row-check" data-idx="${idx}" ${service.checked ? 'checked' : ''}></td>
					<td>${idx + 1}</td>
					<td>${service.spa_type_name}</td>
					<td style="text-align: center;"><input type="number" class="qty-input" data-idx="${idx}" value="${service.qty}" min="1" step="1"></td>
					<td style="text-align: right;">${format_currency(service.rate)}</td>
					<td style="text-align: right;">${format_currency(service.amount)}</td>
					<td><button class="btn btn-xs btn-danger btn-remove-service" data-idx="${idx}" title="Remove"><i class="fa fa-times"></i></button></td>
				</tr>
			`);
		});
		tbody.find('.service-row-check').on('change', function() {
			spaServices[parseInt($(this).data('idx'))].checked = $(this).is(':checked');
			updateDeleteButton();
		});
		tbody.find('.qty-input').on('change', function() {
			const idx = parseInt($(this).data('idx'));
			let qty = parseInt($(this).val()) || 1;
			if (qty < 1) qty = 1;
			$(this).val(qty);
			spaServices[idx].qty = qty;
			spaServices[idx].amount = qty * spaServices[idx].rate;
			$(this).closest('tr').find('td:eq(5)').text(format_currency(spaServices[idx].amount));
			updateTotal();
		});
		tbody.find('.btn-remove-service').on('click', function() {
			removeServicesByIndices([parseInt($(this).data('idx'))]);
		});
		updateDeleteButton();
		updateTotal();
	}

	function updateDeleteButton() {
		const anyChecked = spaServices.some(s => s.checked);
		page.main.find('#delete-selected-btn').toggle(anyChecked);
		page.main.find('#select-all-services').prop('checked', spaServices.length > 0 && spaServices.every(s => s.checked));
	}

	page.main.find('#select-all-services').on('change', function() {
		const checked = $(this).is(':checked');
		spaServices.forEach(s => { s.checked = checked; });
		renderServicesTable();
	});

	page.main.find('#delete-selected-btn').on('click', function() {
		const indices = [];
		spaServices.forEach((s, i) => { if (s.checked) indices.push(i); });
		if (indices.length) removeServicesByIndices(indices);
	});

	page.main.find('#add-service-btn').on('click', function() {
		addService(add_spa_type_field.get_value());
	});

	// =============================================
	// TOGGLE & TABS
	// =============================================
	page.main.find('.toggle-btn').on('click', function() {
		const mode = $(this).data('mode');
		currentMode = mode;
		page.main.find('.toggle-btn').removeClass('active');
		$(this).addClass('active');
		if (mode === 'customer') {
			page.main.find('[data-fieldname="customer_field"]').show();
			page.main.find('[data-fieldname="patient_field"]').hide();
			patient_field.set_value('');
		} else {
			page.main.find('[data-fieldname="patient_field"]').show();
			page.main.find('[data-fieldname="customer_field"]').hide();
			customer_field.set_value('');
		}
	});

	page.main.find('.tab-btn').on('click', function() {
		const tab = $(this).data('tab');
		page.main.find('.tab-btn').removeClass('active');
		$(this).addClass('active');
		page.main.find('.tab-content').removeClass('active');
		page.main.find(`#${tab}-tab`).addClass('active');
		if (tab === 'invoices') loadInvoices();
		if (tab === 'bookings') loadBookingsList();
	});

	// =============================================
	// CREATE INVOICE
	// =============================================
	page.main.find('#create-invoice-btn').on('click', function() {
		if (!spaServices.length) {
			frappe.show_alert({ message: __('Please add at least one spa service'), indicator: 'orange' }, 5);
			return;
		}
		const services = spaServices.map(s => ({ spa_type: s.spa_type, qty: s.qty }));
		frappe.call({
			method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.create_spa_invoice',
			args: {
				customer: currentMode === 'customer' ? customer_field.get_value() : null,
				patient: currentMode === 'patient' ? patient_field.get_value() : null,
				spa_services: JSON.stringify(services),
				posting_date: posting_date_field.get_value()
			},
			freeze: true,
			freeze_message: __('Creating invoice...'),
			callback: function(r) {
				if (r.message && r.message.status === 'Success') {
					frappe.show_alert({
						message: __('Invoice {0} created. Amount: {1}', [r.message.invoice_name, format_currency(r.message.grand_total)]),
						indicator: 'green'
					}, 7);
					customer_field.set_value('');
					patient_field.set_value('');
					add_spa_type_field.set_value('');
					posting_date_field.set_value(frappe.datetime.get_today());
					spaServices = [];
					renderServicesTable();
				}
			},
			error: function() {
				frappe.show_alert({ message: __('Error creating invoice'), indicator: 'red' }, 10);
			}
		});
	});

	// =============================================
	// INVOICES TAB
	// =============================================
	page.main.find('#filter-btn').on('click', function() { loadInvoices(); });

	function loadInvoices() {
		frappe.call({
			method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.get_spa_invoices',
			args: { date: filter_date.get_value() },
			callback: function(r) {
				const invoices = r.message || [];
				renderSummary(invoices);
				renderInvoicesTable(invoices);
			}
		});
	}

	function renderSummary(invoices) {
		let paidAmount = 0, unpaidAmount = 0;
		invoices.forEach(inv => {
			if (inv.status === 'Paid') paidAmount += inv.grand_total;
			else if (inv.outstanding_amount > 0) unpaidAmount += inv.outstanding_amount;
		});
		page.main.find('#summary-stats').html(`
			<div class="stat-box"><div class="stat-label">Total Invoices</div><div class="stat-value">${invoices.length}</div></div>
			<div class="stat-box stat-green"><div class="stat-label">Paid</div><div class="stat-value">${format_currency(paidAmount)}</div></div>
			<div class="stat-box stat-orange"><div class="stat-label">Unpaid</div><div class="stat-value">${format_currency(unpaidAmount)}</div></div>
		`);
	}

	function renderInvoicesTable(invoices) {
		if (!invoices.length) {
			page.main.find('#invoices-table-container').html(`
				<div class="empty-state"><i class="fa fa-file-text-o"></i><h4>${__('No Invoices Found')}</h4><p>${__('No spa invoices found for the selected date.')}</p></div>
			`);
			return;
		}
		let rows = '';
		invoices.forEach(function(inv, idx) {
			const displayName = inv.patient ? inv.patient_name : inv.customer_name;
			let statusBadge = '';
			if (inv.status === 'Paid') statusBadge = '<span class="badge badge-success">Paid</span>';
			else if (inv.outstanding_amount > 0 && inv.due_date < frappe.datetime.get_today()) statusBadge = '<span class="badge badge-danger">Overdue</span>';
			else if (inv.outstanding_amount > 0) statusBadge = '<span class="badge badge-warning">Unpaid</span>';

			let itemsHtml = '';
			if (inv.items && inv.items.length) {
				let itemRows = '';
				inv.items.forEach((item, i) => {
					itemRows += `<tr><td>${i+1}</td><td>${item.item_name||item.item_code}</td><td style="text-align:center;">${item.qty}</td><td style="text-align:right;">${format_currency(item.rate)}</td><td style="text-align:right;">${format_currency(item.amount)}</td></tr>`;
				});
				itemsHtml = `<table class="invoice-items-table"><thead><tr><th>#</th><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${itemRows}</tbody></table>`;
			}
			rows += `
				<tr class="invoice-row" data-invoice="${inv.name}">
					<td><i class="fa fa-caret-right invoice-toggle-icon"></i> ${idx+1}</td>
					<td>${inv.name}</td><td>${displayName||''}</td><td>${inv.posting_date}</td>
					<td>${format_currency(inv.grand_total)}</td><td>${statusBadge}</td>
				</tr>
				<tr class="invoice-items-row" data-invoice-items="${inv.name}"><td colspan="6">${itemsHtml||'<em>No items</em>'}</td></tr>
			`;
		});
		page.main.find('#invoices-table-container').html(`
			<table class="invoices-table"><thead><tr><th>#</th><th>${__('Invoice ID')}</th><th>${__('Customer/Patient')}</th><th>${__('Date')}</th><th>${__('Amount')}</th><th>${__('Status')}</th></tr></thead><tbody>${rows}</tbody></table>
		`);
		page.main.find('.invoice-row').on('click', function() {
			const n = $(this).data('invoice');
			page.main.find(`tr[data-invoice-items="${n}"]`).toggleClass('expanded');
			$(this).find('.invoice-toggle-icon').toggleClass('expanded');
		});
	}

	// =============================================
	// BOOKINGS TAB
	// =============================================

	// View toggle
	page.main.find('.view-toggle-btn').on('click', function() {
		const view = $(this).data('view');
		page.main.find('.view-toggle-btn').removeClass('active');
		$(this).addClass('active');
		if (view === 'list') {
			page.main.find('#bookings-list-view').show();
			page.main.find('#bookings-calendar-view').hide();
			loadBookingsList();
		} else {
			page.main.find('#bookings-list-view').hide();
			page.main.find('#bookings-calendar-view').show();
			renderCalendar();
		}
	});

	// Create booking
	page.main.find('#create-booking-btn').on('click', function() {
		const clientName = bk_client_name.get_value();
		const phone = bk_phone.get_value();
		const spaType = bk_spa_type.get_value();
		const date = bk_date.get_value();
		const time = bk_time.get_value();
		const notes = bk_notes.get_value();

		if (!clientName || !phone || !spaType || !date || !time) {
			frappe.show_alert({ message: __('Please fill in all required fields'), indicator: 'orange' }, 5);
			return;
		}

		frappe.call({
			method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.create_spa_booking',
			args: { client_name: clientName, phone: phone, spa_type: spaType, booking_date: date, booking_time: time, notes: notes },
			freeze: true,
			freeze_message: __('Creating booking...'),
			callback: function(r) {
				if (r.message && r.message.status === 'Success') {
					frappe.show_alert({ message: __('Booking {0} created', [r.message.name]), indicator: 'green' }, 7);
					bk_client_name.set_value('');
					bk_phone.set_value('');
					bk_spa_type.set_value('');
					bk_date.set_value(frappe.datetime.get_today());
					bk_time.set_value('');
					bk_notes.set_value('');
					loadBookingsList();
				}
			}
		});
	});

	page.main.find('#bk-filter-btn').on('click', function() { loadBookingsList(); });

	function loadBookingsList() {
		frappe.call({
			method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.get_spa_bookings',
			args: { date: bk_filter_date.get_value() },
			callback: function(r) {
				renderBookingsList(r.message || []);
			}
		});
	}

	function getStatusBadge(status) {
		const map = {
			'Scheduled': 'badge-info',
			'Completed': 'badge-success',
			'Cancelled': 'badge-danger',
			'No Show': 'badge-secondary'
		};
		return `<span class="badge ${map[status] || 'badge-info'}">${status}</span>`;
	}

	function renderBookingsList(bookings) {
		const container = page.main.find('#bookings-list-container');
		if (!bookings.length) {
			container.html(`<div class="empty-state"><i class="fa fa-calendar-o"></i><h4>${__('No Bookings')}</h4><p>${__('No bookings found for the selected date.')}</p></div>`);
			return;
		}
		let rows = '';
		bookings.forEach(function(bk, idx) {
			rows += `
				<tr>
					<td>${idx+1}</td>
					<td><strong>${bk.client_name}</strong><br><small style="color:#6c757d;">${bk.phone}</small></td>
					<td>${bk.spa_type}</td>
					<td>${bk.booking_time}</td>
					<td>${getStatusBadge(bk.status)}</td>
					<td>
						<select class="booking-status-select" data-name="${bk.name}">
							<option value="Scheduled" ${bk.status==='Scheduled'?'selected':''}>Scheduled</option>
							<option value="Completed" ${bk.status==='Completed'?'selected':''}>Completed</option>
							<option value="Cancelled" ${bk.status==='Cancelled'?'selected':''}>Cancelled</option>
							<option value="No Show" ${bk.status==='No Show'?'selected':''}>No Show</option>
						</select>
					</td>
					<td><small style="color:#6c757d;">${bk.notes||''}</small></td>
				</tr>
			`;
		});
		container.html(`
			<table class="bookings-table">
				<thead><tr><th>#</th><th>Client</th><th>Service</th><th>Time</th><th>Status</th><th>Action</th><th>Notes</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		`);
		container.find('.booking-status-select').on('change', function() {
			const name = $(this).data('name');
			const newStatus = $(this).val();
			frappe.call({
				method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.update_spa_booking_status',
				args: { booking_name: name, status: newStatus },
				callback: function() {
					frappe.show_alert({ message: __('Status updated'), indicator: 'green' }, 3);
					loadBookingsList();
				}
			});
		});
	}

	// =============================================
	// CALENDAR VIEW
	// =============================================
	function renderCalendar() {
		const calContainer = page.main.find('#spa-calendar');
		const firstDay = new Date(calYear, calMonth, 1);
		const lastDay = new Date(calYear, calMonth + 1, 0);
		const startDow = firstDay.getDay(); // 0=Sun
		const daysInMonth = lastDay.getDate();
		const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

		// Date range for query: include prev month padding + next month padding
		const calStart = new Date(calYear, calMonth, 1 - startDow);
		const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
		const calEnd = new Date(calYear, calMonth, 1 - startDow + totalCells - 1);

		const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

		frappe.call({
			method: 'ex_healthcare.ex_healthcare.page.spa_portal.spa_portal.get_spa_bookings',
			args: { from_date: fmt(calStart), to_date: fmt(calEnd) },
			callback: function(r) {
				const bookings = r.message || [];
				// Group by date
				const byDate = {};
				bookings.forEach(bk => {
					if (!byDate[bk.booking_date]) byDate[bk.booking_date] = [];
					byDate[bk.booking_date].push(bk);
				});

				const todayStr = frappe.datetime.get_today();

				let headerHtml = `
					<div class="cal-header">
						<button class="cal-nav-btn" id="cal-prev"><i class="fa fa-chevron-left"></i></button>
						<h5>${monthNames[calMonth]} ${calYear}</h5>
						<button class="cal-nav-btn" id="cal-next"><i class="fa fa-chevron-right"></i></button>
					</div>
				`;

				let gridHtml = '<div class="cal-grid">';
				const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
				dayNames.forEach(d => { gridHtml += `<div class="cal-day-header">${d}</div>`; });

				for (let i = 0; i < totalCells; i++) {
					const cellDate = new Date(calYear, calMonth, 1 - startDow + i);
					const dateStr = fmt(cellDate);
					const isOtherMonth = cellDate.getMonth() !== calMonth;
					const isToday = dateStr === todayStr;

					let classes = 'cal-day';
					if (isOtherMonth) classes += ' other-month';
					if (isToday) classes += ' today';

					let eventsHtml = '';
					if (byDate[dateStr]) {
						byDate[dateStr].forEach(bk => {
							let statusClass = '';
							if (bk.status === 'Completed') statusClass = ' status-completed';
							else if (bk.status === 'Cancelled') statusClass = ' status-cancelled';
							else if (bk.status === 'No Show') statusClass = ' status-no-show';
							const timeStr = bk.booking_time ? bk.booking_time.substring(0,5) : '';
							eventsHtml += `<div class="cal-event${statusClass}" title="${bk.client_name} - ${bk.spa_type} (${bk.status})">${timeStr} ${bk.client_name}</div>`;
						});
					}

					gridHtml += `<div class="${classes}"><div class="cal-day-num">${cellDate.getDate()}</div>${eventsHtml}</div>`;
				}
				gridHtml += '</div>';

				calContainer.html(headerHtml + gridHtml);

				calContainer.find('#cal-prev').on('click', function() {
					calMonth--;
					if (calMonth < 0) { calMonth = 11; calYear--; }
					renderCalendar();
				});
				calContainer.find('#cal-next').on('click', function() {
					calMonth++;
					if (calMonth > 11) { calMonth = 0; calYear++; }
					renderCalendar();
				});
			}
		});
	}
};


//# sourceURL=spa_portal.js