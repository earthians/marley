frappe.pages['cashier-portal'].on_page_load = function(wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Healthcare Cashier',
        single_column: true
    });

    // Add custom CSS
    const style = `
        <style>
            .cashier-wrapper {
                padding: 20px;
                max-width: 1400px;
                margin: 0 auto;
            }

            .search-section {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 25px;
                border-radius: 12px;
                margin-bottom: 20px;
                color: white;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            }

            .search-section h4 {
                color: white;
                margin-bottom: 15px;
                font-weight: 600;
                font-size: 1.1rem;
            }

            .search-input-group {
                display: flex;
                gap: 15px;
                align-items: end;
            }

            .search-input-group .frappe-control {
                flex: 1;
            }

            .search-input-group .form-group {
                margin-bottom: 0;
            }

            .search-input-group label {
                color: white !important;
                font-weight: 500;
            }

            .btn-clear {
                background: rgba(255, 255, 255, 0.2) !important;
                color: white !important;
                border: 1px solid rgba(255, 255, 255, 0.3) !important;
            }

            .btn-clear:hover {
                background: rgba(255, 255, 255, 0.3) !important;
            }

            .patient-card {
                background: white;
                border: 1px solid #d1d8dd;
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            }

            .patient-card h5 {
                color: #2c3e50;
                margin-bottom: 15px;
                font-weight: 600;
                font-size: 1rem;
            }

            .patient-info {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-bottom: 15px;
            }

            .info-field {
                display: flex;
                flex-direction: column;
            }

            .info-label {
                font-size: 0.8rem;
                color: #6c757d;
                margin-bottom: 4px;
                font-weight: 500;
            }

            .info-value {
                font-size: 0.95rem;
                font-weight: 600;
                color: #2c3e50;
            }

            /* Tab Navigation */
            .tab-navigation {
                display: flex;
                gap: 10px;
                border-bottom: 2px solid #e0e0e0;
                margin-bottom: 15px;
                padding-bottom: 0;
                align-items: center;
            }

            .tab-button {
                padding: 10px 20px;
                background: transparent;
                border: none;
                border-bottom: 3px solid transparent;
                color: #6c757d;
                font-weight: 600;
                font-size: 0.95rem;
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
                bottom: -2px;
            }

            .tab-button:hover {
                color: var(--primary-color);
            }

            .tab-button.active {
                color: var(--primary-color);
                border-bottom-color: var(--primary-color);
            }

            .tab-button .badge {
                margin-left: 8px;
                font-size: 0.75rem;
                padding: 2px 6px;
            }

            .tab-content {
                display: none;
            }

            .tab-content.active {
                display: block;
            }

            /* Payment Summary Toggle */
            .payment-summary-toggle {
                margin-left: auto;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 5px 15px;
                background: #f8f9fa;
                border-radius: 20px;
            }

            .payment-summary-toggle label {
                margin: 0;
                font-size: 0.85rem;
                color: #495057;
                cursor: pointer;
            }

            .payment-summary-toggle input[type="checkbox"] {
                cursor: pointer;
            }

            /* Payment Filters */
            .payment-filters {
                margin-bottom: 15px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 8px;
                display: grid;
                grid-template-columns: 1fr 1fr 2fr;
                gap: 15px;
                align-items: end;
            }

            .payment-filters .frappe-control {
                margin-bottom: 0;
            }

            /* Total Summary Card */
            .payment-total-card {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                border-radius: 12px;
                margin-bottom: 20px;
                text-align: center;
            }

            .payment-total-card h3 {
                margin: 0 0 10px 0;
                font-size: 1.2rem;
                color: white;
                opacity: 0.9;
            }

            .payment-total-card .total-amount {
                font-size: 2.5rem;
                font-weight: 700;
                margin: 0;
                color: white;
            }

            .payment-total-card .total-count {
                font-size: 1rem;
                opacity: 0.9;
                margin-top: 10px;
            }

            /* Search Box for Payments */
            .payment-search-box {
                margin-bottom: 15px;
                position: relative;
            }

            .payment-search-box input {
                width: 100%;
                padding: 10px 40px 10px 15px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                font-size: 0.9rem;
                transition: all 0.3s ease;
            }

            .payment-search-box input:focus {
                border-color: var(--primary-color);
                outline: none;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }

            .payment-search-box i {
                position: absolute;
                right: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: #6c757d;
            }

            /* Compact Card Design */
            .invoice-card, .payment-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 12px 15px;
                margin-bottom: 10px;
                transition: all 0.2s ease;
            }

            .invoice-card:hover {
                border-color: var(--primary-color);
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }

            .card-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 15px;
                cursor: pointer;
            }

            .card-left {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .card-id-section {
                min-width: 140px;
            }

            .card-id {
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--primary-color);
                margin-bottom: 2px;
            }

            .card-type {
                font-size: 0.75rem;
                color: #6c757d;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .card-info {
                display: flex;
                gap: 20px;
                flex-wrap: wrap;
                flex: 1;
            }

            .info-item {
                display: flex;
                flex-direction: column;
            }

            .info-item-label {
                font-size: 0.7rem;
                color: #6c757d;
                margin-bottom: 2px;
            }

            .info-item-value {
                font-size: 0.85rem;
                font-weight: 600;
                color: #2c3e50;
            }

            .card-right {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .card-amount {
                text-align: right;
                min-width: 100px;
            }

            .amount-label-small {
                font-size: 0.7rem;
                color: #6c757d;
                margin-bottom: 2px;
            }

            .amount-value-large {
                font-size: 1.1rem;
                font-weight: 700;
                color: #dc3545;
            }

            .card-badge {
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.7rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                white-space: nowrap;
            }

            .badge-overdue {
                background: #f8d7da;
                color: #721c24;
            }

            .badge-unpaid {
                background: #fff3cd;
                color: #856404;
            }

            .badge-pending {
                background: #d1ecf1;
                color: #0c5460;
            }

            .badge-paid {
                background: #d4edda;
                color: #155724;
            }

            .badge-pharmacy {
                background: #e7f3ff;
                color: #004085;
            }

            .badge-laboratory {
                background: #fff3e0;
                color: #e65100;
            }

            .badge-rehabilitation {
                background: #f3e5f5;
                color: #4a148c;
            }

            .btn-pay {
                padding: 6px 16px;
                font-size: 0.85rem;
                font-weight: 600;
                border-radius: 6px;
                white-space: nowrap;
                min-width: 100px;
            }

            .btn-print {
                padding: 6px 12px;
                font-size: 0.85rem;
                font-weight: 600;
                border-radius: 6px;
                white-space: nowrap;
                background: #6c757d !important;
                border-color: #6c757d !important;
            }

            .btn-print:hover {
                background: #5a6268 !important;
            }

            /* Invoice Items Dropdown */
            .invoice-items-section {
                display: none;
                padding: 15px;
                margin-top: 10px;
                background: #f8f9fa;
                border-radius: 6px;
                border-top: 2px solid #e0e0e0;
            }

            .invoice-items-section.show {
                display: block;
            }

            .invoice-items-header {
                font-size: 0.85rem;
                font-weight: 700;
                color: #495057;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .invoice-items-table {
                width: 100%;
                font-size: 0.85rem;
            }

            .invoice-items-table th {
                padding: 8px;
                text-align: left;
                background: #e9ecef;
                font-weight: 600;
                color: #495057;
                border-bottom: 2px solid #dee2e6;
            }

            .invoice-items-table td {
                padding: 8px;
                border-bottom: 1px solid #dee2e6;
            }

            .invoice-items-table tr:last-child td {
                border-bottom: none;
            }

            .invoice-items-table .text-right {
                text-align: right;
            }

            .items-loading {
                text-align: center;
                padding: 20px;
                color: #6c757d;
            }

            .dropdown-arrow {
                transition: transform 0.3s ease;
                display: inline-block;
                margin-left: 5px;
                font-size: 0.7rem;
            }

            .dropdown-arrow.rotated {
                transform: rotate(180deg);
            }

            .empty-state {
                text-align: center;
                padding: 50px 20px;
                color: #6c757d;
            }

            .empty-state i {
                font-size: 48px;
                margin-bottom: 15px;
                opacity: 0.5;
            }

            .empty-state.success i {
                color: #28a745;
            }

            .empty-state.info i {
                color: #17a2b8;
            }

            .empty-state h5 {
                font-size: 1.1rem;
                margin-bottom: 8px;
                color: #495057;
            }

            .empty-state p {
                font-size: 0.9rem;
                margin: 0;
            }

            /* Payment Dialog Styles */
            .payment-summary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
            }

            .payment-summary h4 {
                margin: 0 0 15px 0;
                color: white;
                font-size: 1.1rem;
            }

            .summary-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                font-size: 0.95rem;
            }

            .summary-row:last-child {
                font-size: 1.2rem;
                font-weight: 700;
                padding-top: 10px;
                border-top: 2px solid rgba(255,255,255,0.3);
            }

            @media (max-width: 768px) {
                .cashier-wrapper {
                    padding: 15px;
                }

                .search-input-group {
                    flex-direction: column;
                    gap: 10px;
                }

                .patient-info {
                    grid-template-columns: 1fr;
                }

                .card-row {
                    flex-direction: column;
                    align-items: flex-start;
                }

                .card-left {
                    width: 100%;
                    flex-direction: column;
                    align-items: flex-start;
                }

                .card-right {
                    width: 100%;
                    justify-content: space-between;
                }

                .tab-navigation {
                    overflow-x: auto;
                    flex-wrap: wrap;
                }

                .tab-button {
                    white-space: nowrap;
                }

                .payment-filters {
                    grid-template-columns: 1fr;
                }

                .payment-summary-toggle {
                    margin-left: 0;
                    margin-top: 10px;
                }
            }
        </style>
    `;

    $(style).appendTo(page.main);

    // Create the UI
    let html = `
        <div class="cashier-wrapper">
            <!-- Welcome Section -->
            <div class="welcome-section" style="background: white; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0; color: #2c3e50; font-size: 1.1rem;">
                        <i class="fa fa-user-circle"></i> Welcome, <span id="cashier-name" style="color: #667eea; font-weight: 700;"></span>
                    </h4>
                    <p style="margin: 5px 0 0 0; color: #6c757d; font-size: 0.85rem;">Cashier Portal - Ex Healthcare</p>
                </div>
                <button class="btn btn-primary" id="view-transactions-btn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; padding: 10px 20px; font-weight: 600;">
                    <i class="fa fa-list-alt"></i> View Daily Transactions
                </button>
            </div>

            <div class="search-section">
                <h4><i class="fa fa-search"></i> Lookup</h4>
                <div class="search-input-group">
                    <div class="frappe-control" data-fieldname="search_type"></div>
                    <div class="frappe-control" data-fieldname="patient_id" style="display:none;"></div>
                    <div class="frappe-control" data-fieldname="customer_id" style="display:none;"></div>
                    <button class="btn btn-primary btn-lg" id="search-btn" style="background: white; color: #667eea; border: none; font-weight: 600;">
                        <i class="fa fa-search"></i> Get Details
                    </button>
                    <button class="btn btn-clear btn-lg" id="clear-btn">
                        <i class="fa fa-times"></i> Clear
                    </button>
                </div>
            </div>

            <div class="details-section" style="display: none;">
                <div class="patient-card">
                    <h5 id="info-header"><i class="fa fa-user"></i> Information</h5>
                    <div class="patient-info" id="info-display">
                    </div>

                    <!-- Tab Navigation -->
                    <div class="tab-navigation">
                        <button class="tab-button active" data-tab="other-invoices">
                            <i class="fa fa-file-text"></i> Other Invoices
                            <span class="badge badge-warning" id="other-invoices-count">0</span>
                        </button>
                        <button class="tab-button" data-tab="pharmacy-invoices">
                            <i class="fa fa-medkit"></i> Pharmacy
                            <span class="badge badge-info" id="pharmacy-invoices-count">0</span>
                        </button>
                        <button class="tab-button" data-tab="laboratory-invoices">
                            <i class="fa fa-flask"></i> Laboratory
                            <span class="badge badge-info" id="laboratory-invoices-count">0</span>
                        </button>
                        <button class="tab-button" data-tab="rehabilitation-invoices">
                            <i class="fa fa-heartbeat"></i> Rehabilitation
                            <span class="badge badge-info" id="rehabilitation-invoices-count">0</span>
                        </button>
                        <button class="tab-button" data-tab="payments">
                            <i class="fa fa-money"></i> Payment History
                            <span class="badge badge-secondary" id="payments-count">0</span>
                        </button>
                        
                        <!-- Toggle for summary/list view -->
                        <div class="payment-summary-toggle" style="display:none;" id="summary-toggle-container">
                            <input type="checkbox" id="show-summary-toggle">
                            <label for="show-summary-toggle">Show Total Summary</label>
                        </div>
                    </div>
                </div>

                <!-- Other Invoices Tab -->
                <div class="tab-content active" id="other-invoices-tab">
                    <div id="other-invoices-container"></div>
                </div>

                <!-- Pharmacy Invoices Tab -->
                <div class="tab-content" id="pharmacy-invoices-tab">
                    <div id="pharmacy-invoices-container"></div>
                </div>

                <!-- Laboratory Invoices Tab -->
                <div class="tab-content" id="laboratory-invoices-tab">
                    <div id="laboratory-invoices-container"></div>
                </div>

                <!-- Rehabilitation Invoices Tab -->
                <div class="tab-content" id="rehabilitation-invoices-tab">
                    <div id="rehabilitation-invoices-container"></div>
                </div>

                <!-- Payments Tab -->
                <div class="tab-content" id="payments-tab">
                    <!-- Payment Filters -->
                    <div class="payment-filters">
                        <div class="frappe-control" data-fieldname="filter_created_by"></div>
                        <div class="frappe-control" data-fieldname="filter_date"></div>
                        <div class="payment-search-box">
                            <input type="text" id="payment-search-input" placeholder="Search payments by ID, method, reference, or invoice...">
                            <i class="fa fa-search"></i>
                        </div>
                    </div>
                    
                    <!-- Total Summary Card (shown when toggle is on) -->
                    <div id="payment-summary-card" style="display:none;"></div>
                    
                    <!-- Payment List -->
                    <div id="payments-container"></div>
                </div>
            </div>
        </div>
    `;

    $(html).appendTo(page.main);

    // Store all payments for search and filtering
    let allPayments = [];
    let currentSearchType = 'Patient';

    // Display cashier name
    frappe.call({
        method: 'frappe.client.get_value',
        args: {
            doctype: 'User',
            filters: { name: frappe.session.user },
            fieldname: ['full_name', 'first_name']
        },
        callback: function(r) {
            if (r.message) {
                const name = r.message.full_name || r.message.first_name || frappe.session.user;
                page.main.find('#cashier-name').text(name);
            }
        }
    });

    // View Daily Transactions button handler
    page.main.find('#view-transactions-btn').on('click', function() {
        showDailyTransactionsDialog();
    });

    // Create search type field
    let search_type_field = frappe.ui.form.make_control({
        parent: page.main.find('[data-fieldname="search_type"]'),
        df: {
            fieldtype: 'Select',
            fieldname: 'search_type',
            options: 'Patient\nCustomer',
            label: 'Search By',
            default: 'Patient',
            onchange: function() {
                const selected = this.get_value();
                currentSearchType = selected;
                
                if (selected === 'Patient') {
                    page.main.find('[data-fieldname="patient_id"]').show();
                    page.main.find('[data-fieldname="customer_id"]').hide();
                    customer_field.set_value('');
                } else {
                    page.main.find('[data-fieldname="patient_id"]').hide();
                    page.main.find('[data-fieldname="customer_id"]').show();
                    patient_field.set_value('');
                }
            }
        },
        render_input: true
    });

    // Create patient field
    let patient_field = frappe.ui.form.make_control({
        parent: page.main.find('[data-fieldname="patient_id"]'),
        df: {
            fieldtype: 'Link',
            fieldname: 'patient_id',
            options: 'Patient',
            label: 'Patient ID',
            placeholder: 'Enter or search Patient ID'
        },
        render_input: true
    });

    // Create customer field
    let customer_field = frappe.ui.form.make_control({
        parent: page.main.find('[data-fieldname="customer_id"]'),
        df: {
            fieldtype: 'Link',
            fieldname: 'customer_id',
            options: 'Customer',
            label: 'Customer',
            placeholder: 'Enter or search Customer'
        },
        render_input: true
    });

    // Create payment filter fields
    let filter_created_by = frappe.ui.form.make_control({
        parent: page.main.find('[data-fieldname="filter_created_by"]'),
        df: {
            fieldtype: 'Link',
            fieldname: 'filter_created_by',
            options: 'User',
            label: 'Created By',
            default: frappe.session.user,
            read_only: 1
        },
        render_input: true
    });

    let filter_date = frappe.ui.form.make_control({
        parent: page.main.find('[data-fieldname="filter_date"]'),
        df: {
            fieldtype: 'Date',
            fieldname: 'filter_date',
            label: 'Payment Date',
            default: frappe.datetime.get_today(),
            onchange: function() {
                filterAndDisplayPayments();
            }
        },
        render_input: true
    });

    // Set default values
    search_type_field.set_value('Patient');
    filter_created_by.set_value(frappe.session.user);
    filter_date.set_value(frappe.datetime.get_today());

    // Show patient field by default
    page.main.find('[data-fieldname="patient_id"]').show();

    // Tab switching functionality
    page.main.find('.tab-button').on('click', function() {
        const tabName = $(this).data('tab');
        
        // Update active states
        page.main.find('.tab-button').removeClass('active');
        $(this).addClass('active');
        
        page.main.find('.tab-content').removeClass('active');
        page.main.find(`#${tabName}-tab`).addClass('active');

        // Show/hide summary toggle only on payments tab
        if (tabName === 'payments') {
            page.main.find('#summary-toggle-container').show();
        } else {
            page.main.find('#summary-toggle-container').hide();
        }
    });

    // Summary toggle functionality
    page.main.find('#show-summary-toggle').on('change', function() {
        const showSummary = $(this).is(':checked');
        if (showSummary) {
            page.main.find('#payment-summary-card').show();
            page.main.find('#payments-container').hide();
            displayPaymentSummary();
        } else {
            page.main.find('#payment-summary-card').hide();
            page.main.find('#payments-container').show();
        }
    });

    // Payment search functionality
    page.main.find('#payment-search-input').on('input', function() {
        filterAndDisplayPayments();
    });

    function filterAndDisplayPayments() {
        const searchTerm = page.main.find('#payment-search-input').val().toLowerCase();
        const filterDate = filter_date.get_value();
        const filterUser = filter_created_by.get_value();

        let filtered = allPayments.filter(payment => {
            // Filter by date
            if (filterDate && payment.posting_date !== filterDate) {
                return false;
            }

            // Filter by user
            if (filterUser && payment.owner !== filterUser) {
                return false;
            }

            // Filter by search term
            if (searchTerm) {
                return (
                    payment.name.toLowerCase().includes(searchTerm) ||
                    (payment.mode_of_payment && payment.mode_of_payment.toLowerCase().includes(searchTerm)) ||
                    (payment.reference_no && payment.reference_no.toLowerCase().includes(searchTerm)) ||
                    (payment.invoices && payment.invoices.toLowerCase().includes(searchTerm)) ||
                    (payment.remarks && payment.remarks.toLowerCase().includes(searchTerm))
                );
            }

            return true;
        });

        displayPayments(filtered, page);
        
        // Update summary if visible
        if (page.main.find('#show-summary-toggle').is(':checked')) {
            displayPaymentSummary(filtered);
        }
    }

    function displayPaymentSummary(payments = null) {
        const paymentsToSummarize = payments || allPayments;
        const filterDate = filter_date.get_value();
        const filterUser = filter_created_by.get_value();

        // Apply filters if not already filtered
        let filtered = paymentsToSummarize;
        if (!payments) {
            filtered = paymentsToSummarize.filter(payment => {
                if (filterDate && payment.posting_date !== filterDate) return false;
                if (filterUser && payment.owner !== filterUser) return false;
                return true;
            });
        }

        const totalAmount = filtered.reduce((sum, payment) => sum + (payment.paid_amount || 0), 0);
        const count = filtered.length;

        const summaryCard = `
            <div class="payment-total-card">
                <h3>Total Payments Collected</h3>
                <p class="total-amount">${format_currency(totalAmount)}</p>
                <p class="total-count">${count} payment${count !== 1 ? 's' : ''} ${filterDate ? 'on ' + frappe.datetime.str_to_user(filterDate) : ''}</p>
            </div>
        `;

        page.main.find('#payment-summary-card').html(summaryCard);
    }

    // Clear button functionality
    page.main.find('#clear-btn').on('click', function() {
        patient_field.set_value('');
        customer_field.set_value('');
        page.main.find('.details-section').slideUp(300);
        page.main.find('#payment-search-input').val('');
        page.main.find('#show-summary-toggle').prop('checked', false);
        page.main.find('#payment-summary-card').hide();
        page.main.find('#payments-container').show();
        filter_date.set_value(frappe.datetime.get_today());
        allPayments = [];
        
        // Focus on appropriate field
        if (currentSearchType === 'Patient') {
            patient_field.$input.focus();
        } else {
            customer_field.$input.focus();
        }
    });

    // Search button click handler
    page.main.find('#search-btn').on('click', function() {
        if (currentSearchType === 'Patient') {
            const patient_id = patient_field.get_value();
            
            if (!patient_id) {
                frappe.show_alert({
                    message: __('Please enter a Patient ID'),
                    indicator: 'red'
                });
                patient_field.$input.focus();
                return;
            }

            loadPatientData(patient_id, page);
        } else {
            const customer_id = customer_field.get_value();
            
            if (!customer_id) {
                frappe.show_alert({
                    message: __('Please enter a Customer'),
                    indicator: 'red'
                });
                customer_field.$input.focus();
                return;
            }

            loadCustomerData(customer_id, page);
        }
    });

    // Enter key handlers
    patient_field.$input.on('keypress', function(e) {
        if (e.which === 13) {
            page.main.find('#search-btn').click();
        }
    });

    customer_field.$input.on('keypress', function(e) {
        if (e.which === 13) {
            page.main.find('#search-btn').click();
        }
    });

    // Auto-focus on patient field
    setTimeout(() => {
        patient_field.$input.focus();
    }, 500);

    // Helper function to toggle invoice items
    function toggleInvoiceItems(invoiceCard, invoiceName, doctype) {
        const itemsSection = invoiceCard.find('.invoice-items-section');
        const arrow = invoiceCard.find('.dropdown-arrow');
        
        if (itemsSection.hasClass('show')) {
            itemsSection.removeClass('show');
            arrow.removeClass('rotated');
        } else {
            // Check if items are already loaded
            if (itemsSection.find('.invoice-items-table').length === 0) {
                // Show loading state
                itemsSection.html('<div class="items-loading"><i class="fa fa-spinner fa-spin"></i> Loading items...</div>');
                itemsSection.addClass('show');
                arrow.addClass('rotated');
                
                // Fetch invoice items
                frappe.call({
                    method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_invoice_items',
                    args: {
                        invoice_name: invoiceName,
                        doctype: doctype
                    },
                    callback: function(r) {
                        if (r.message && r.message.items && r.message.items.length > 0) {
                            let itemsHtml = `
                                <div class="invoice-items-header">
                                    <i class="fa fa-list"></i> Invoice Items
                                </div>
                                <table class="invoice-items-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 5%;">#</th>
                                            <th style="width: 40%;">Item</th>
                                            <th style="width: 10%;" class="text-right">Qty</th>
                                            <th style="width: 15%;" class="text-right">Rate</th>
                                            <th style="width: 15%;" class="text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                            `;
                            
                            r.message.items.forEach((item, index) => {
                                itemsHtml += `
                                    <tr>
                                        <td>${index + 1}</td>
                                        <td>
                                            <strong>${item.item_name || item.item_code}</strong>
                                            ${item.description ? `<br><small style="color: #6c757d;">${item.description}</small>` : ''}
                                        </td>
                                        <td class="text-right">${item.qty}</td>
                                        <td class="text-right">${format_currency(item.rate)}</td>
                                        <td class="text-right"><strong>${format_currency(item.amount)}</strong></td>
                                    </tr>
                                `;
                            });
                            
                            itemsHtml += `
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 700; background: #e9ecef;">
                                            <td colspan="4" class="text-right">Total:</td>
                                            <td class="text-right">${format_currency(r.message.total)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            `;
                            
                            itemsSection.html(itemsHtml);
                        } else {
                            itemsSection.html('<div class="items-loading">No items found</div>');
                        }
                    },
                    error: function() {
                        itemsSection.html('<div class="items-loading" style="color: #dc3545;">Error loading items</div>');
                    }
                });
            } else {
                itemsSection.addClass('show');
                arrow.addClass('rotated');
            }
        }
    }

    // Helper function to load patient data
    function loadPatientData(patient_id, page) {
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_patient_data',
            args: {
                patient_id: patient_id
            },
            freeze: true,
            freeze_message: __('Loading patient data...'),
            callback: function(r) {
                if (r.message) {
                    displayEntityInfo(r.message.patient, 'patient', page);
                    displayOtherInvoices(r.message.other_invoices, page);
                    displayPharmacyInvoices(r.message.pharmacy_orders, page);
                    displayLaboratoryInvoices(r.message.laboratory_invoices, page);
                    displayRehabilitationInvoices(r.message.rehabilitation_invoices, page);
                    allPayments = r.message.payments;
                    filterAndDisplayPayments();
                    page.main.find('.details-section').slideDown();
                    
                    // Reset to other invoices tab
                    page.main.find('.tab-button').removeClass('active');
                    page.main.find('.tab-button[data-tab="other-invoices"]').addClass('active');
                    page.main.find('.tab-content').removeClass('active');
                    page.main.find('#other-invoices-tab').addClass('active');
                    page.main.find('#summary-toggle-container').hide();
                    
                    // Clear search and reset summary toggle
                    page.main.find('#payment-search-input').val('');
                    page.main.find('#show-summary-toggle').prop('checked', false);
                    page.main.find('#payment-summary-card').hide();
                    page.main.find('#payments-container').show();
                }
            },
            error: function(r) {
                frappe.show_alert({
                    message: r.message || __('Error loading patient data'),
                    indicator: 'red'
                });
                page.main.find('.details-section').slideUp();
            }
        });
    }

    // Helper function to load customer data
    function loadCustomerData(customer_id, page) {
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_customer_data',
            args: {
                customer_id: customer_id
            },
            freeze: true,
            freeze_message: __('Loading customer data...'),
            callback: function(r) {
                if (r.message) {
                    displayEntityInfo(r.message.customer, 'customer', page);
                    displayOtherInvoices(r.message.other_invoices, page);
                    displayPharmacyInvoices(r.message.pharmacy_orders, page);
                    displayLaboratoryInvoices(r.message.laboratory_invoices, page);
                    displayRehabilitationInvoices(r.message.rehabilitation_invoices, page);
                    allPayments = r.message.payments;
                    filterAndDisplayPayments();
                    page.main.find('.details-section').slideDown();
                    
                    // Reset to other invoices tab
                    page.main.find('.tab-button').removeClass('active');
                    page.main.find('.tab-button[data-tab="other-invoices"]').addClass('active');
                    page.main.find('.tab-content').removeClass('active');
                    page.main.find('#other-invoices-tab').addClass('active');
                    page.main.find('#summary-toggle-container').hide();
                    
                    // Clear search and reset summary toggle
                    page.main.find('#payment-search-input').val('');
                    page.main.find('#show-summary-toggle').prop('checked', false);
                    page.main.find('#payment-summary-card').hide();
                    page.main.find('#payments-container').show();
                }
            },
            error: function(r) {
                frappe.show_alert({
                    message: r.message || __('Error loading customer data'),
                    indicator: 'red'
                });
                page.main.find('.details-section').slideUp();
            }
        });
    }

    // Helper function to display entity info (patient or customer)
    function displayEntityInfo(entity, type, page) {
        if (type === 'patient') {
            page.main.find('#info-header').html('<i class="fa fa-user"></i> Patient Information');
            page.main.find('#info-display').html(`
                <div class="info-field">
                    <span class="info-label">Patient ID</span>
                    <span class="info-value">${entity.name}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Patient Name</span>
                    <span class="info-value">${entity.patient_name}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Mobile</span>
                    <span class="info-value">${entity.mobile || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Gender</span>
                    <span class="info-value">${entity.sex || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Email</span>
                    <span class="info-value">${entity.email || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Blood Group</span>
                    <span class="info-value">${entity.blood_group || 'N/A'}</span>
                </div>
            `);
        } else {
            page.main.find('#info-header').html('<i class="fa fa-building"></i> Customer Information');
            page.main.find('#info-display').html(`
                <div class="info-field">
                    <span class="info-label">Customer ID</span>
                    <span class="info-value">${entity.name}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Customer Name</span>
                    <span class="info-value">${entity.customer_name}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Mobile</span>
                    <span class="info-value">${entity.mobile_no || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Email</span>
                    <span class="info-value">${entity.email_id || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Customer Type</span>
                    <span class="info-value">${entity.customer_type || 'N/A'}</span>
                </div>
                <div class="info-field">
                    <span class="info-label">Territory</span>
                    <span class="info-value">${entity.territory || 'N/A'}</span>
                </div>
            `);
        }
    }

    // Helper function to display other invoices
    function displayOtherInvoices(invoices, page) {
        const container = page.main.find('#other-invoices-container');
        container.empty();

        page.main.find('#other-invoices-count').text(invoices.length);

        if (invoices.length === 0) {
            container.html(`
                <div class="empty-state success">
                    <i class="fa fa-check-circle"></i>
                    <h5>No Pending Invoices</h5>
                    <p>No outstanding invoices found.</p>
                </div>
            `);
            return;
        }

        invoices.forEach(function(invoice) {
            const isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date();
            const badgeClass = isOverdue ? 'badge-overdue' : 'badge-unpaid';
            const badgeText = isOverdue ? 'Overdue' : 'Unpaid';

            const card = $(`
                <div class="invoice-card">
                    <div class="card-row">
                        <div class="card-left">
                            <div class="card-id-section">
                                <div class="card-id">${invoice.name} <i class="fa fa-chevron-down dropdown-arrow"></i></div>
                                <div class="card-type">Sales Invoice</div>
                            </div>
                            <div class="card-info">
                                <div class="info-item">
                                    <span class="info-item-label">Date</span>
                                    <span class="info-item-value">${frappe.datetime.str_to_user(invoice.posting_date)}</span>
                                </div>
                                ${invoice.due_date ? `
                                <div class="info-item">
                                    <span class="info-item-label">Due Date</span>
                                    <span class="info-item-value">${frappe.datetime.str_to_user(invoice.due_date)}</span>
                                </div>
                                ` : ''}
                                <div class="info-item">
                                    <span class="info-item-label">Status</span>
                                    <span class="info-item-value">${invoice.status}</span>
                                </div>
                            </div>
                        </div>
                        <div class="card-right">
                            <div class="card-amount">
                                <div class="amount-label-small">Outstanding</div>
                                <div class="amount-value-large">${format_currency(invoice.outstanding_amount, invoice.currency)}</div>
                            </div>
                            <span class="card-badge ${badgeClass}">${badgeText}</span>
                            <button class="btn btn-success btn-pay" data-invoice="${invoice.name}">
                                <i class="fa fa-money"></i> Pay
                            </button>
                        </div>
                    </div>
                    <div class="invoice-items-section"></div>
                </div>
            `);

            // Add click handler for dropdown
            card.find('.card-row').on('click', function(e) {
                // Don't trigger if clicking on the pay button
                if (!$(e.target).closest('.btn-pay').length) {
                    toggleInvoiceItems(card, invoice.name, 'Sales Invoice');
                }
            });

            // Add click handler to pay button
            card.find('.btn-pay').on('click', function(e) {
                e.stopPropagation();
                showPaymentDialog(invoice, 'invoice', page);
            });

            container.append(card);
        });
    }

    // Helper function to display pharmacy invoices (sales orders)
    function displayPharmacyInvoices(orders, page) {
        const container = page.main.find('#pharmacy-invoices-container');
        container.empty();

        page.main.find('#pharmacy-invoices-count').text(orders.length);

        if (orders.length === 0) {
            container.html(`
                <div class="empty-state info">
                    <i class="fa fa-medkit"></i>
                    <h5>No Pharmacy Orders</h5>
                    <p>No pending pharmacy orders found.</p>
                </div>
            `);
            return;
        }

        orders.forEach(function(order) {
            const card = createDepartmentInvoiceCard(order, 'Pharmacy', 'pharmacy', 'badge-pharmacy', page);
            container.append(card);
        });
    }

    // Helper function to display laboratory invoices (sales invoices)
    function displayLaboratoryInvoices(invoices, page) {
        const container = page.main.find('#laboratory-invoices-container');
        container.empty();

        page.main.find('#laboratory-invoices-count').text(invoices.length);

        if (invoices.length === 0) {
            container.html(`
                <div class="empty-state info">
                    <i class="fa fa-flask"></i>
                    <h5>No Laboratory Invoices</h5>
                    <p>No pending laboratory invoices found.</p>
                </div>
            `);
            return;
        }

        invoices.forEach(function(invoice) {
            const card = createDepartmentInvoiceCardFromInvoice(invoice, 'Laboratory', 'badge-laboratory', page);
            container.append(card);
        });
    }

    // Helper function to display rehabilitation invoices (sales invoices)
    function displayRehabilitationInvoices(invoices, page) {
        const container = page.main.find('#rehabilitation-invoices-container');
        container.empty();

        page.main.find('#rehabilitation-invoices-count').text(invoices.length);

        if (invoices.length === 0) {
            container.html(`
                <div class="empty-state info">
                    <i class="fa fa-heartbeat"></i>
                    <h5>No Rehabilitation Invoices</h5>
                    <p>No pending rehabilitation invoices found.</p>
                </div>
            `);
            return;
        }

        invoices.forEach(function(invoice) {
            const card = createDepartmentInvoiceCardFromInvoice(invoice, 'Rehabilitation', 'badge-rehabilitation', page);
            container.append(card);
        });
    }

    // Helper function to create department invoice card from Sales Invoice (for Lab & Rehab)
    function createDepartmentInvoiceCardFromInvoice(invoice, departmentName, badgeClass, page) {
        const card = $(`
            <div class="invoice-card">
                <div class="card-row">
                    <div class="card-left">
                        <div class="card-id-section">
                            <div class="card-id">${invoice.name} <i class="fa fa-chevron-down dropdown-arrow"></i></div>
                            <div class="card-type">${departmentName} Invoice</div>
                        </div>
                        <div class="card-info">
                            <div class="info-item">
                                <span class="info-item-label">Date</span>
                                <span class="info-item-value">${frappe.datetime.str_to_user(invoice.posting_date)}</span>
                            </div>
                            ${invoice.due_date ? `
                            <div class="info-item">
                                <span class="info-item-label">Due Date</span>
                                <span class="info-item-value">${frappe.datetime.str_to_user(invoice.due_date)}</span>
                            </div>
                            ` : ''}
                            <div class="info-item">
                                <span class="info-item-label">Status</span>
                                <span class="info-item-value">${invoice.status}</span>
                            </div>
                        </div>
                    </div>
                    <div class="card-right">
                        <div class="card-amount">
                            <div class="amount-label-small">Outstanding</div>
                            <div class="amount-value-large">${format_currency(invoice.outstanding_amount, invoice.currency)}</div>
                        </div>
                        <span class="card-badge ${badgeClass}">${departmentName}</span>
                        <button class="btn btn-success btn-pay" data-invoice="${invoice.name}">
                            <i class="fa fa-money"></i> Pay
                        </button>
                    </div>
                </div>
                <div class="invoice-items-section"></div>
            </div>
        `);

        // Add click handler for dropdown
        card.find('.card-row').on('click', function(e) {
            // Don't trigger if clicking on the pay button
            if (!$(e.target).closest('.btn-pay').length) {
                toggleInvoiceItems(card, invoice.name, 'Sales Invoice');
            }
        });

        // Add click handler to pay button
        card.find('.btn-pay').on('click', function(e) {
            e.stopPropagation();
            showPaymentDialog(invoice, 'invoice', page);
        });

        return card;
    }

    // Helper function to create department invoice card (reusable for Pharmacy)
    function createDepartmentInvoiceCard(order, departmentName, departmentType, badgeClass, page) {
        const card = $(`
            <div class="invoice-card">
                <div class="card-row">
                    <div class="card-left">
                        <div class="card-id-section">
                            <div class="card-id">${order.name} <i class="fa fa-chevron-down dropdown-arrow"></i></div>
                            <div class="card-type">${departmentName} Order</div>
                        </div>
                        <div class="card-info">
                            <div class="info-item">
                                <span class="info-item-label">Date</span>
                                <span class="info-item-value">${frappe.datetime.str_to_user(order.date)}</span>
                            </div>
                            ${order.delivery_date ? `
                            <div class="info-item">
                                <span class="info-item-label">Delivery</span>
                                <span class="info-item-value">${frappe.datetime.str_to_user(order.delivery_date)}</span>
                            </div>
                            ` : ''}
                            <div class="info-item">
                                <span class="info-item-label">Billed</span>
                                <span class="info-item-value">${order.per_billed || 0}%</span>
                            </div>
                        </div>
                    </div>
                    <div class="card-right">
                        <div class="card-amount">
                            <div class="amount-label-small">Total</div>
                            <div class="amount-value-large">${format_currency(order.grand_total, order.currency)}</div>
                        </div>
                        <span class="card-badge ${badgeClass}">${departmentName}</span>
                        <button class="btn btn-success btn-pay" data-order="${order.name}">
                            <i class="fa fa-money"></i> Pay
                        </button>
                    </div>
                </div>
                <div class="invoice-items-section"></div>
            </div>
        `);

        // Add click handler for dropdown
        card.find('.card-row').on('click', function(e) {
            // Don't trigger if clicking on the pay button
            if (!$(e.target).closest('.btn-pay').length) {
                toggleInvoiceItems(card, order.name, 'Sales Order');
            }
        });

        // Add click handler to pay button
        card.find('.btn-pay').on('click', function(e) {
            e.stopPropagation();
            showPaymentDialog(order, departmentType + '_order', page);
        });

        return card;
    }

    // Helper function to display payments
    function displayPayments(payments, page) {
        const container = page.main.find('#payments-container');
        container.empty();

        page.main.find('#payments-count').text(allPayments.length);

        if (payments.length === 0) {
            if (allPayments.length > 0) {
                container.html(`
                    <div class="empty-state info">
                        <i class="fa fa-search"></i>
                        <h5>No Matching Payments</h5>
                        <p>Try adjusting your filters or search terms.</p>
                    </div>
                `);
            } else {
                container.html(`
                    <div class="empty-state info">
                        <i class="fa fa-money"></i>
                        <h5>No Payment History</h5>
                        <p>No payment records found.</p>
                    </div>
                `);
            }
            return;
        }

        payments.forEach(function(payment) {
            const card = $(`
                <div class="payment-card">
                    <div class="card-row">
                        <div class="card-left">
                            <div class="card-id-section">
                                <div class="card-id">${payment.name}</div>
                                <div class="card-type">Payment Entry</div>
                            </div>
                            <div class="card-info">
                                <div class="info-item">
                                    <span class="info-item-label">Date</span>
                                    <span class="info-item-value">${frappe.datetime.str_to_user(payment.posting_date)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-item-label">Method</span>
                                    <span class="info-item-value">${payment.mode_of_payment || 'N/A'}</span>
                                </div>
                                ${payment.reference_no ? `
                                <div class="info-item">
                                    <span class="info-item-label">Ref No</span>
                                    <span class="info-item-value">${payment.reference_no}</span>
                                </div>
                                ` : ''}
                                ${payment.reference_date ? `
                                <div class="info-item">
                                    <span class="info-item-label">Ref Date</span>
                                    <span class="info-item-value">${frappe.datetime.str_to_user(payment.reference_date)}</span>
                                </div>
                                ` : ''}
                                ${payment.invoices ? `
                                <div class="info-item">
                                    <span class="info-item-label">Invoices</span>
                                    <span class="info-item-value">${payment.invoices}</span>
                                </div>
                                ` : ''}
                                ${payment.remarks ? `
                                <div class="info-item">
                                    <span class="info-item-label">Remarks</span>
                                    <span class="info-item-value" style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${payment.remarks}">${payment.remarks}</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="card-right">
                            <div class="card-amount">
                                <div class="amount-label-small">Paid</div>
                                <div class="amount-value-large" style="color: #28a745;">${format_currency(payment.paid_amount)}</div>
                            </div>
                            <span class="card-badge badge-paid">Paid</span>
                            <button class="btn btn-secondary btn-print" data-payment="${payment.name}">
                                <i class="fa fa-print"></i> Print
                            </button>
                        </div>
                    </div>
                </div>
            `);

            // Print button handler
            card.find('.btn-print').on('click', function(e) {
                e.stopPropagation();
                printPaymentReceipt(payment.name);
            });

            container.append(card);
        });
    }

    // Show payment dialog
    function showPaymentDialog(doc, type, page) {
        // Get available payment methods
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_payment_methods',
            callback: function(r) {
                const payment_methods = r.message || [];
                
                if (payment_methods.length === 0) {
                    frappe.show_alert({
                        message: __('No payment methods configured. Please configure payment methods first.'),
                        indicator: 'red'
                    });
                    return;
                }
                
                // Only pharmacy_order needs special handling
                const isPharmacyOrder = type === 'pharmacy_order';
                const amount = doc.outstanding_amount || doc.grand_total;
                
                // Get document label and icon
                let docLabel = 'Invoice';
                let iconClass = 'file-text';
                let entityName = page.main.find('#info-display .info-value').first().text();
                
                if (isPharmacyOrder) {
                    docLabel = 'Pharmacy Order';
                    iconClass = 'medkit';
                }
                
                const dialog = new frappe.ui.Dialog({
                    title: __('Process Payment'),
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'payment_summary',
                            options: `
                                <div class="payment-summary">
                                    <h4><i class="fa fa-${iconClass}"></i> Payment Details</h4>
                                    <div class="summary-row">
                                        <span>${docLabel}:</span>
                                        <span><strong>${doc.name}</strong></span>
                                    </div>
                                    <div class="summary-row">
                                        <span>${currentSearchType}:</span>
                                        <span><strong>${entityName}</strong></span>
                                    </div>
                                    <div class="summary-row">
                                        <span>Amount to Pay:</span>
                                        <span><strong>${format_currency(amount, doc.currency)}</strong></span>
                                    </div>
                                </div>
                            `
                        },
                        {
                            fieldtype: 'Select',
                            fieldname: 'mode_of_payment',
                            label: 'Payment Method',
                            options: payment_methods.map(m => m.name),
                            reqd: 1,
                            onchange: function() {
                                const selected_method = this.get_value();
                                const method_data = payment_methods.find(m => m.name === selected_method);
                                
                                // Show/hide bank fields based on payment type
                                if (method_data && method_data.type === 'Bank') {
                                    dialog.set_df_property('reference_date', 'hidden', 0);
                                    dialog.set_df_property('reference_no', 'hidden', 0);
                                } else {
                                    dialog.set_df_property('reference_date', 'hidden', 1);
                                    dialog.set_df_property('reference_no', 'hidden', 1);
                                }
                            }
                        },
                        {
                            fieldtype: 'Date',
                            fieldname: 'reference_date',
                            label: 'Reference Date',
                            default: frappe.datetime.get_today(),
                            hidden: 1
                        },
                        {
                            fieldtype: 'Data',
                            fieldname: 'reference_no',
                            label: 'Reference Number',
                            hidden: 1
                        },
                        {
                            fieldtype: 'Small Text',
                            fieldname: 'remarks',
                            label: 'Remarks (Optional)',
                            description: 'Any additional notes about this payment'
                        }
                    ],
                    primary_action_label: __('Process Payment'),
                    primary_action: function(values) {
                        if (!values.mode_of_payment) {
                            frappe.show_alert({
                                message: __('Please select a payment method'),
                                indicator: 'red'
                            });
                            return;
                        }

                        // Validate bank fields if payment type is Bank
                        const method_data = payment_methods.find(m => m.name === values.mode_of_payment);
                        if (method_data && method_data.type === 'Bank') {
                            if (!values.reference_no) {
                                frappe.show_alert({
                                    message: __('Please enter Reference Number for bank payment'),
                                    indicator: 'red'
                                });
                                return;
                            }
                            if (!values.reference_date) {
                                frappe.show_alert({
                                    message: __('Please enter Reference Date for bank payment'),
                                    indicator: 'red'
                                });
                                return;
                            }
                        }

                        dialog.hide();
                        
                        if (isPharmacyOrder) {
                            // Only pharmacy orders create invoice+payment+delivery
                            processDepartmentPayment(doc.name, values, type, page);
                        } else {
                            // All other invoices (Other, Lab, Rehab) use direct payment
                            processInvoicePayment(doc.name, values, page);
                        }
                    },
                    secondary_action_label: __('Cancel')
                });

                dialog.show();
            }
        });
    }

    // Process invoice payment (regular sales invoice)
    function processInvoicePayment(invoice_name, values, page) {
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.create_payment_entry',
            args: {
                invoice_name: invoice_name,
                mode_of_payment: values.mode_of_payment,
                remarks: values.remarks || null,
                reference_no: values.reference_no || null,
                reference_date: values.reference_date || null
            },
            freeze: true,
            freeze_message: __('Processing payment...'),
            callback: function(r) {
                if (r.message && r.message.status === 'Success') {
                    frappe.show_alert({
                        message: __('Payment processed successfully! Payment Entry: {0}', [r.message.name]),
                        indicator: 'green'
                    }, 10);

                    // Ask if they want to print receipt
                    frappe.confirm(
                        __('Payment successful! Would you like to print the receipt?'),
                        function() {
                            printPaymentReceipt(r.message.name);
                        }
                    );

                    // Reload data
                    setTimeout(() => {
                        if (currentSearchType === 'Patient') {
                            const patient_id = patient_field.get_value();
                            if (patient_id) {
                                loadPatientData(patient_id, page);
                            }
                        } else {
                            const customer_id = customer_field.get_value();
                            if (customer_id) {
                                loadCustomerData(customer_id, page);
                            }
                        }
                    }, 1500);
                }
            },
            error: function(r) {
                frappe.show_alert({
                    message: r.message || __('Error processing payment'),
                    indicator: 'red'
                }, 10);
            }
        });
    }

    // Process department payment (pharmacy - create invoice from order + payment + delivery note)
    function processDepartmentPayment(order_name, values, type, page) {
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.create_invoice_and_payment_from_order',
            args: {
                order_name: order_name,
                mode_of_payment: values.mode_of_payment,
                remarks: values.remarks || null,
                reference_no: values.reference_no || null,
                reference_date: values.reference_date || null
            },
            freeze: true,
            freeze_message: __('Creating invoice, payment, and delivery note...'),
            callback: function(r) {
                if (r.message && r.message.status === 'Success') {
                    // Show success message with all created documents
                    let message = __('Payment processed successfully!<br>');
                    message += __('Invoice: {0}<br>', [r.message.invoice_name]);
                    message += __('Payment: {0}<br>', [r.message.payment_name]);
                    message += __('Delivery Note: {0}', [r.message.delivery_note_name]);
                    
                    frappe.show_alert({
                        message: message,
                        indicator: 'green'
                    }, 15);

                    // Ask if they want to print receipt
                    frappe.confirm(
                        __('Payment successful! Would you like to print the receipt?'),
                        function() {
                            printPaymentReceipt(r.message.payment_name);
                        }
                    );

                    // Reload data
                    setTimeout(() => {
                        if (currentSearchType === 'Patient') {
                            const patient_id = patient_field.get_value();
                            if (patient_id) {
                                loadPatientData(patient_id, page);
                            }
                        } else {
                            const customer_id = customer_field.get_value();
                            if (customer_id) {
                                loadCustomerData(customer_id, page);
                            }
                        }
                    }, 1500);
                }
            },
            error: function(r) {
                frappe.show_alert({
                    message: r.message || __('Error creating invoice, payment, and delivery note'),
                    indicator: 'red'
                }, 10);
            }
        });
    }

    // Print payment receipt
    function printPaymentReceipt(payment_name) {
        frappe.call({
            method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_print_content',
            args: {
                doctype: 'Payment Entry',
                docname: payment_name
            },
            callback: function(r) {
                if (r.message && r.message.html) {
                    const printWindow = window.open('', '_blank');
                    printWindow.document.write(r.message.html);
                    printWindow.document.close();
                    setTimeout(() => {
                        printWindow.print();
                    }, 500);
                } else {
                    frappe.utils.print('Payment Entry', payment_name);
                }
            },
            error: function() {
                frappe.utils.print('Payment Entry', payment_name);
            }
        });
    }

    // Show Daily Transactions Dialog
    function showDailyTransactionsDialog() {
        let transactionsData = [];
        
        const dialog = new frappe.ui.Dialog({
            title: __('Daily Transactions Report'),
            size: 'extra-large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'welcome_section',
                    options: `
                        <div style="padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; margin-bottom: 20px;">
                            <h4 style="margin: 0 0 5px 0; color: white;"><i class="fa fa-user-circle"></i> Cashier: <span id="dialog-cashier-name"></span></h4>
                            <p style="margin: 0; opacity: 0.9; font-size: 0.9rem;">Daily Transactions Report</p>
                        </div>
                    `
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'cashier',
                    label: 'Cashier (User)',
                    options: 'User',
                    default: frappe.session.user,
                    read_only: 1,
                    reqd: 1
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'transaction_date',
                    label: 'Transaction Date',
                    default: frappe.datetime.get_today(),
                    reqd: 1,
                    onchange: function() {
                        // Auto-load when date changes
                        const values = dialog.get_values();
                        if (values.transaction_date) {
                            loadTransactions(values.cashier, values.transaction_date, dialog);
                        }
                    }
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'transactions_summary',
                    options: '<div id="transactions-summary-container"></div>'
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'transactions_list',
                    options: '<div id="transactions-list-container"></div>'
                }
            ],
            primary_action_label: __('Print Report'),
            primary_action: function(values) {
                if (transactionsData.length === 0) {
                    frappe.show_alert({
                        message: __('No transactions to print'),
                        indicator: 'orange'
                    });
                    return;
                }
                printDailyTransactions(transactionsData, values.cashier, values.transaction_date);
            },
            secondary_action_label: __('Refresh'),
            secondary_action: function() {
                const values = dialog.get_values();
                loadTransactions(values.cashier, values.transaction_date, dialog);
            }
        });

        dialog.show();

        // Set cashier name in dialog
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'User',
                filters: { name: frappe.session.user },
                fieldname: ['full_name', 'first_name']
            },
            callback: function(r) {
                if (r.message) {
                    const name = r.message.full_name || r.message.first_name || frappe.session.user;
                    dialog.$wrapper.find('#dialog-cashier-name').text(name);
                }
            }
        });

        // Load initial data
        loadTransactions(frappe.session.user, frappe.datetime.get_today(), dialog);

        function loadTransactions(cashier, date, dialog) {
            frappe.call({
                method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_daily_transactions',
                args: {
                    cashier: cashier,
                    transaction_date: date
                },
                freeze: true,
                freeze_message: __('Loading transactions...'),
                callback: function(r) {
                    if (r.message) {
                        transactionsData = r.message.transactions;
                        displayTransactionsSummary(r.message, dialog);
                        displayTransactionsList(r.message.transactions, dialog);
                    }
                }
            });
        }

        function displayTransactionsSummary(data, dialog) {
            const container = dialog.$wrapper.find('#transactions-summary-container');
            
            // Build payment methods dynamically
            let paymentMethodsHtml = '';
            const paymentMethods = {};
            
            // Group by payment method
            data.transactions.forEach(t => {
                if (t.docstatus === 1 && t.mode_of_payment) {
                    const method = t.mode_of_payment;
                    if (!paymentMethods[method]) {
                        paymentMethods[method] = { total: 0, count: 0 };
                    }
                    paymentMethods[method].total += t.paid_amount || 0;
                    paymentMethods[method].count += 1;
                }
            });
            
            // Generate HTML for each payment method
            Object.keys(paymentMethods).sort().forEach(method => {
                const data = paymentMethods[method];
                paymentMethodsHtml += `
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 0.9rem; color: #495057; font-weight: 600;">${method}</div>
                        <div style="font-size: 1.3rem; font-weight: 700; color: #2c3e50;">${format_currency(data.total)}</div>
                        <div style="font-size: 0.8rem; color: #6c757d;">${data.count} transaction(s)</div>
                    </div>
                `;
            });
            
            const html = `
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                    <div>
                        <div style="font-size: 0.9rem; color: #6c757d; margin-bottom: 5px;">Total Transactions</div>
                        <div style="font-size: 2rem; font-weight: 700; color: #667eea;">${data.total_count}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.9rem; color: #6c757d; margin-bottom: 5px;">Total Amount</div>
                        <div style="font-size: 2rem; font-weight: 700; color: #28a745;">${format_currency(data.total_amount)}</div>
                    </div>
                    ${paymentMethodsHtml}
                </div>
            `;
            
            container.html(html);
        }

        function displayTransactionsList(transactions, dialog) {
            const container = dialog.$wrapper.find('#transactions-list-container');
            
            if (transactions.length === 0) {
                container.html(`
                    <div style="text-align: center; padding: 50px; color: #6c757d;">
                        <i class="fa fa-inbox" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
                        <h5>No Transactions Found</h5>
                        <p>No transactions recorded for this date.</p>
                    </div>
                `);
                return;
            }

            let tableHtml = `
                <div style="overflow-x: auto;">
                    <table class="table table-bordered table-hover" style="margin: 0; font-size: 0.9rem;">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th style="width: 5%;">#</th>
                                <th style="width: 15%;">Payment ID</th>
                                <th style="width: 10%;">Time</th>
                                <th style="width: 20%;">Patient/Customer</th>
                                <th style="width: 20%;">Invoice(s)</th>
                                <th style="width: 10%;">Payment Method</th>
                                <th style="width: 10%;">Ref No</th>
                                <th style="width: 10%;" class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            transactions.forEach((txn, index) => {
                tableHtml += `
                    <tr>
                        <td>${index + 1}</td>
                        <td><strong>${txn.name}</strong></td>
                        <td>${txn.posting_time || 'N/A'}</td>
                        <td>
                            <div style="font-weight: 600;">${txn.party_name || txn.party}</div>
                            <div style="font-size: 0.8rem; color: #6c757d;">${txn.party}</div>
                        </td>
                        <td><small>${txn.invoices || 'N/A'}</small></td>
                        <td>
                            <span class="badge badge-info">${txn.mode_of_payment || 'N/A'}</span>
                        </td>
                        <td><small>${txn.reference_no || '-'}</small></td>
                        <td class="text-right"><strong>${format_currency(txn.paid_amount)}</strong></td>
                    </tr>
                `;
            });

            tableHtml += `
                        </tbody>
                        <tfoot style="background: #f8f9fa; font-weight: 700;">
                            <tr>
                                <td colspan="7" class="text-right">GRAND TOTAL:</td>
                                <td class="text-right" style="font-size: 1.1rem; color: #28a745;">
                                    ${format_currency(transactions.reduce((sum, t) => sum + (t.paid_amount || 0), 0))}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;

            container.html(tableHtml);
        }

        function printDailyTransactions(transactions, cashier, date) {
            frappe.call({
                method: 'ex_healthcare.ex_healthcare.page.cashier_portal.cashier_portal.get_daily_transactions_print',
                args: {
                    cashier: cashier,
                    transaction_date: date,
                    transactions: transactions
                },
                callback: function(r) {
                    if (r.message && r.message.html) {
                        const printWindow = window.open('', '_blank');
                        printWindow.document.write(r.message.html);
                        printWindow.document.close();
                        setTimeout(() => {
                            printWindow.print();
                        }, 500);
                    }
                }
            });
        }
    }
};
            
            

//# sourceURL=cashier_portal.js