frappe.pages['pharmacy-pos'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Pharmacy POS',
		single_column: true
	});

	new PharmacyPOS(page);
}

class PharmacyPOS {
	constructor(page) {
    this.page = page;
    this.wrapper = $(this.page.wrapper);
    this.cart_items = [];
    this.customer = null;
    this.patient = null;
    this.show_orders = false;
    this.active_category = 'all';
    this.medications = [];
    this.view_mode = 'grid';
    this.load_view_preference();
    
    this.make();
	}

	make() {
		this.prepare_dom();
		this.setup_fields();
		this.bind_events();
		this.set_user_info();
		// Apply saved view preference to UI buttons only
		this.wrapper.find('.view-btn').removeClass('active');
		this.wrapper.find(`.view-btn-${this.view_mode}`).addClass('active');
		this.load_data(); // This will render items with correct view
	}

	prepare_dom() {
		this.wrapper.html(`
			<div class="pharmacy-pos-wrapper">
				<style>
					/* ===== ROOT VARIABLES - LIGHT THEME ===== */
					:root {
						--primary: #6366f1;
						--primary-light: #818cf8;
						--primary-dark: #4f46e5;
						--success: #10b981;
						--success-light: #34d399;
						--warning: #f59e0b;
						--danger: #ef4444;
						--bg-dark: #f8fafc;
						--bg-card: #ffffff;
						--bg-elevated: #f1f5f9;
						--text-primary: #1e293b;
						--text-secondary: #475569;
						--text-muted: #94a3b8;
						--border-color: #e2e8f0;
						--glass-bg: rgba(255, 255, 255, 0.9);
						--glass-border: rgba(148, 163, 184, 0.2);
					}

					.pharmacy-pos-wrapper {
						height: calc(100vh - 60px);
						display: flex;
						flex-direction: column;
						background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f8fafc 100%);
						font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
						overflow: hidden;
					}

					/* ===== HEADER SECTION ===== */
					.pos-header-section {
						background: var(--glass-bg);
						backdrop-filter: blur(20px);
						padding: 16px 24px;
						border-bottom: 1px solid var(--border-color);
						display: flex;
						gap: 16px;
						align-items: center;
						flex-wrap: wrap;
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
						position: relative;
						z-index: 100;
					}

					.pos-field {
						flex: 1;
						min-width: 200px;
						position: relative;
						z-index: 101;
					}

					.pos-field label {
						font-size: 11px;
						color: var(--text-secondary);
						font-weight: 600;
						margin-bottom: 6px;
						display: block;
						text-transform: uppercase;
						letter-spacing: 0.5px;
					}

					.pos-field input, .pos-field select {
						width: 100%;
						padding: 10px 14px;
						border: 1px solid var(--border-color);
						border-radius: 10px;
						font-size: 14px;
						background: var(--bg-card);
						color: var(--text-primary);
						transition: all 0.2s ease;
					}

					.pos-field input:focus, .pos-field select:focus {
						outline: none;
						border-color: var(--primary);
						box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
					}

					.pos-actions {
						display: flex;
						gap: 10px;
						align-items: center;
					}

					.pos-btn {
						padding: 10px 18px;
						border: none;
						border-radius: 10px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
						font-size: 13px;
						display: flex;
						align-items: center;
						gap: 6px;
					}

					.pos-btn-primary {
						background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
						color: white;
						box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
					}

					.pos-btn-primary:hover {
						transform: translateY(-2px);
						box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
					}

					.pos-btn-secondary {
						background: var(--bg-elevated);
						color: var(--text-primary);
						border: 1px solid var(--border-color);
					}

					.pos-btn-secondary:hover {
						background: var(--bg-card);
						border-color: var(--primary);
					}

					.pos-btn:disabled {
						opacity: 0.5;
						cursor: not-allowed;
						transform: none !important;
					}

					.orders-toggle {
						display: flex;
						align-items: center;
						gap: 8px;
						cursor: pointer;
						padding: 10px 16px;
						background: var(--bg-elevated);
						border-radius: 10px;
						transition: all 0.2s ease;
						user-select: none;
						border: 1px solid var(--border-color);
					}

					.orders-toggle:hover {
						border-color: var(--primary);
					}

					.orders-toggle.active {
						background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
						border-color: transparent;
					}

					.toggle-switch {
						width: 40px;
						height: 22px;
						background: var(--bg-card);
						border-radius: 11px;
						position: relative;
						transition: background 0.3s;
					}

					.orders-toggle.active .toggle-switch {
						background: rgba(255,255,255,0.2);
					}

					.toggle-switch::after {
						content: '';
						position: absolute;
						width: 16px;
						height: 16px;
						background: white;
						border-radius: 50%;
						top: 3px;
						left: 3px;
						transition: transform 0.3s;
					}

					.orders-toggle.active .toggle-switch::after {
						transform: translateX(18px);
					}

					.view-toggle {
						display: flex;
						gap: 4px;
						background: var(--bg-elevated);
						border-radius: 10px;
						padding: 4px;
						border: 1px solid var(--border-color);
					}

					.view-btn {
						padding: 8px 14px;
						border: none;
						border-radius: 8px;
						background: transparent;
						color: var(--text-secondary);
						font-size: 13px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
						display: flex;
						align-items: center;
						gap: 6px;
					}

					.view-btn:hover {
						color: var(--text-primary);
					}

					.view-btn.active {
						background: var(--primary);
						color: white;
					}

					/* List view styles */
					.items-list {
						display: flex;
						flex-direction: column;
						gap: 12px;
					}

					.item-list-row {
						background: var(--bg-card);
						border-radius: 12px;
						padding: 14px;
						border: 1px solid var(--border-color);
						display: grid;
						grid-template-columns: 60px 1fr 120px 100px 80px 80px;
						gap: 14px;
						align-items: center;
						cursor: pointer;
						transition: all 0.2s ease;
					}

					.item-list-row:hover {
						border-color: var(--primary);
						box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
					}

					.item-list-row.out-of-stock {
						opacity: 0.5;
						cursor: not-allowed;
					}

					.item-list-image {
						width: 60px;
						height: 60px;
						border-radius: 8px;
						background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 28px;
					}

					.item-list-details {
						display: flex;
						flex-direction: column;
						gap: 4px;
					}

					.item-list-name {
						font-weight: 600;
						font-size: 14px;
						color: var(--text-primary);
					}

					.item-list-meta {
						font-size: 12px;
						color: var(--text-muted);
					}

					.item-list-tags {
						display: flex;
						gap: 6px;
					}

					.item-list-tag {
						font-size: 11px;
						padding: 2px 8px;
						border-radius: 4px;
						background: var(--bg-elevated);
						color: var(--text-secondary);
					}

					.item-list-class {
						font-size: 13px;
						color: var(--text-secondary);
					}

					.item-list-stock {
						font-size: 14px;
						font-weight: 600;
					}

					.item-list-stock.in-stock {
						color: var(--success);
					}

					.item-list-stock.low-stock {
						color: var(--warning);
					}

					.item-list-stock.out-of-stock {
						color: var(--danger);
					}

					.item-list-price {
						font-size: 16px;
						font-weight: 700;
						color: var(--success);
					}

					.item-list-add-btn {
						padding: 8px 16px;
						background: var(--primary);
						color: white;
						border: none;
						border-radius: 8px;
						font-size: 13px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
					}

					.item-list-add-btn:hover {
						background: var(--primary-dark);
					}

					.item-list-add-btn:disabled {
						background: var(--bg-elevated);
						color: var(--text-muted);
						cursor: not-allowed;
					}

					.toggle-label {
						font-size: 13px;
						font-weight: 600;
						color: var(--text-primary);
					}

					/* ===== MAIN BODY ===== */
					.pos-body {
						display: grid;
						grid-template-columns: 1fr 400px;
						gap: 0;
						flex: 1;
						overflow: hidden;
						min-height: 0;
						height: calc(100vh - 130px);
					}

					/* ===== ITEMS SECTION ===== */
					.pos-items-section {
						display: flex;
						flex-direction: column;
						height: 100%;
						max-height: calc(100vh - 130px);
						overflow: hidden;
						padding: 20px;
						gap: 16px;
					}

					/* Search Bar */
					.search-section {
						display: flex;
						gap: 12px;
						align-items: center;
					}

					.search-wrapper {
						position: relative;
						flex: 1;
					}

					.search-wrapper::before {
						content: '🔍';
						position: absolute;
						left: 16px;
						top: 50%;
						transform: translateY(-50%);
						font-size: 16px;
						z-index: 1;
					}

					.search-input {
						width: 100%;
						padding: 14px 16px 14px 48px;
						border: 1px solid var(--border-color);
						border-radius: 12px;
						font-size: 15px;
						background: var(--bg-card);
						color: var(--text-primary);
						transition: all 0.2s ease;
					}

					.search-input::placeholder {
						color: var(--text-muted);
					}

					.search-input:focus {
						outline: none;
						border-color: var(--primary);
						box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
						background: var(--bg-elevated);
					}

					.reload-btn {
						width: 48px;
						height: 48px;
						border-radius: 12px;
						background: var(--bg-card);
						border: 1px solid var(--border-color);
						color: var(--text-primary);
						font-size: 18px;
						cursor: pointer;
						transition: all 0.2s ease;
						display: flex;
						align-items: center;
						justify-content: center;
					}

					.reload-btn:hover {
						background: var(--primary);
						border-color: var(--primary);
						transform: rotate(180deg);
					}

					.reload-btn.loading {
						animation: spin 1s linear infinite;
					}

					@keyframes spin {
						from { transform: rotate(0deg); }
						to { transform: rotate(360deg); }
					}

					/* Category Filters */
					.category-section {
						display: flex;
						gap: 10px;
						align-items: center;
						flex-wrap: wrap;
					}

					.category-pill {
						padding: 8px 16px;
						border-radius: 20px;
						font-size: 13px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
						background: var(--bg-card);
						color: var(--text-secondary);
						border: 1px solid var(--border-color);
						display: flex;
						align-items: center;
						gap: 6px;
					}

					.category-pill:hover {
						border-color: var(--primary);
						color: var(--text-primary);
					}

					.category-pill.active {
						background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
						color: white;
						border-color: transparent;
						box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
					}

					.category-count {
						background: rgba(255,255,255,0.2);
						padding: 2px 8px;
						border-radius: 10px;
						font-size: 11px;
					}

					.category-pill:not(.active) .category-count {
						background: var(--bg-elevated);
					}

					/* Items Grid */
					.items-container {
						flex: 1;
						overflow-y: auto;
						overflow-x: hidden;
						min-height: 0;
						padding-right: 8px;
					}

					.items-container::-webkit-scrollbar {
						width: 6px;
					}

					.items-container::-webkit-scrollbar-track {
						background: transparent;
					}

					.items-container::-webkit-scrollbar-thumb {
						background: #cbd5e1;
						border-radius: 3px;
					}

					.items-container::-webkit-scrollbar-thumb:hover {
						background: #94a3b8;
					}

					.items-grid {
						display: grid;
						grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
						gap: 16px;
					}

					/* Item Cards */
					.item-card {
						background: var(--bg-card);
						border-radius: 16px;
						overflow: hidden;
						cursor: pointer;
						transition: all 0.3s ease;
						border: 1px solid var(--border-color);
						display: flex;
						flex-direction: column;
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
					}

					.item-card:hover {
						transform: translateY(-4px);
						box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
						border-color: var(--primary);
					}

					.item-card.out-of-stock {
						opacity: 0.5;
						cursor: not-allowed;
					}

					.item-card.out-of-stock:hover {
						transform: none;
						box-shadow: none;
						border-color: var(--border-color);
					}

					.item-card-image {
						height: 100px;
						background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 40px;
						position: relative;
						overflow: hidden;
					}

					.item-card-img {
						width: 100%;
						height: 100%;
						object-fit: cover;
					}

					.item-card-img-fallback {
						width: 100%;
						height: 100%;
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 40px;
					}

					.item-card.low-stock .item-card-image {
						background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%);
					}

					.item-card.out-of-stock .item-card-image {
						background: linear-gradient(135deg, #475569 0%, #334155 100%);
					}

					.item-card-image::after {
						content: '';
						position: absolute;
						top: -50%;
						right: -50%;
						width: 100%;
						height: 100%;
						background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
						pointer-events: none;
					}

					.item-card-tags {
						display: flex;
						flex-wrap: wrap;
						gap: 4px;
						margin-bottom: 8px;
					}

					.item-card-strength {
						font-size: 10px;
						background: var(--bg-elevated);
						padding: 3px 8px;
						border-radius: 4px;
						color: var(--text-secondary);
					}

					.item-card-dosage-form {
						font-size: 10px;
						background: rgba(99, 102, 241, 0.1);
						padding: 3px 8px;
						border-radius: 4px;
						color: var(--primary);
					}

					.stock-badge {
						position: absolute;
						top: 8px;
						right: 8px;
						padding: 4px 8px;
						border-radius: 6px;
						font-size: 10px;
						font-weight: 700;
						background: rgba(0,0,0,0.4);
						color: white;
						backdrop-filter: blur(4px);
					}

					.stock-badge.low {
						background: rgba(245, 158, 11, 0.9);
					}

					.stock-badge.out {
						background: rgba(239, 68, 68, 0.9);
					}

					.item-card-content {
						padding: 14px;
						flex: 1;
						display: flex;
						flex-direction: column;
						gap: 8px;
					}

					.item-card-name {
						font-weight: 600;
						font-size: 13px;
						color: var(--text-primary);
						line-height: 1.3;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						overflow: hidden;
					}

					.item-card-meta {
						font-size: 11px;
						color: var(--text-muted);
					}

					.item-card-footer {
						display: flex;
						justify-content: space-between;
						align-items: center;
						margin-top: auto;
					}

					.item-card-price {
						font-size: 16px;
						font-weight: 700;
						color: var(--success);
					}

					.item-card-strength {
						font-size: 10px;
						background: var(--bg-elevated);
						padding: 3px 8px;
						border-radius: 4px;
						color: var(--text-secondary);
					}

					/* Footer Stats */
					.items-footer {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding: 12px 16px;
						background: var(--bg-card);
						border-radius: 12px;
						border: 1px solid var(--border-color);
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
						flex-shrink: 0;
						margin-top: auto;
					}

					.items-stats {
						display: flex;
						gap: 20px;
					}

					.stat-item {
						display: flex;
						align-items: center;
						gap: 6px;
						font-size: 13px;
						color: var(--text-secondary);
					}

					.stat-value {
						font-weight: 700;
						color: var(--text-primary);
					}

					.stat-item.in-stock .stat-value {
						color: var(--success);
					}

					.stat-item.out-of-stock .stat-value {
						color: var(--danger);
					}

					.user-badge {
						display: flex;
						align-items: center;
						gap: 8px;
						padding: 8px 14px;
						background: var(--bg-elevated);
						border-radius: 20px;
						font-size: 12px;
						color: var(--text-primary);
						border: 1px solid var(--border-color);
					}

					.user-avatar {
						width: 28px;
						height: 28px;
						border-radius: 50%;
						background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 12px;
						font-weight: 600;
					}

					/* ===== CART SECTION ===== */
					.pos-cart-section {
						background: var(--bg-card);
						display: flex;
						flex-direction: column;
						border-left: 1px solid var(--border-color);
						box-shadow: -2px 0 10px rgba(0, 0, 0, 0.05);
						height: 100%;
						max-height: calc(100vh - 130px);
						overflow: hidden;
					}

					.cart-header {
						padding: 20px;
						background: var(--bg-card);
						border-bottom: 1px solid var(--border-color);
						flex-shrink: 0;
					}

					.cart-header-content {
						display: flex;
						justify-content: space-between;
						align-items: center;
					}

					.cart-title {
						font-size: 18px;
						font-weight: 700;
						color: var(--text-primary);
						display: flex;
						align-items: center;
						gap: 10px;
					}

					.cart-count-badge {
						background: var(--primary);
						color: white;
						padding: 4px 12px;
						border-radius: 20px;
						font-size: 13px;
						font-weight: 600;
					}

					.clear-cart-btn {
						background: transparent;
						color: var(--danger);
						border: 1px solid var(--danger);
						padding: 6px 14px;
						border-radius: 8px;
						font-size: 12px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
						display: flex;
						align-items: center;
						gap: 4px;
					}

					.clear-cart-btn:hover {
						background: var(--danger);
						color: white;
					}

					.cart-items-wrapper {
						flex: 1;
						overflow-y: auto;
						padding: 16px;
						min-height: 0;
						max-height: calc(100vh - 380px);
					}

					.cart-items-wrapper::-webkit-scrollbar {
						width: 4px;
					}

					.cart-items-wrapper::-webkit-scrollbar-thumb {
						background: #cbd5e1;
						border-radius: 2px;
					}

					.cart-item {
						background: var(--bg-elevated);
						border-radius: 12px;
						padding: 14px;
						margin-bottom: 10px;
						border: 1px solid var(--border-color);
						transition: all 0.2s ease;
					}

					.cart-item:hover {
						border-color: var(--primary);
						box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
					}

					.cart-item-row {
						display: flex;
						justify-content: space-between;
						align-items: flex-start;
						margin-bottom: 10px;
						gap: 12px;
					}

					.cart-item-image-wrapper {
						width: 50px;
						height: 50px;
						border-radius: 8px;
						overflow: hidden;
						flex-shrink: 0;
						background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
					}

					.cart-item-image {
						width: 100%;
						height: 100%;
						object-fit: cover;
					}

					.cart-item-image-placeholder {
						width: 100%;
						height: 100%;
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 24px;
					}

					.cart-item-details {
						flex: 1;
						min-width: 0;
					}

					.cart-item-name {
						font-weight: 600;
						font-size: 14px;
						color: var(--text-primary);
						margin-bottom: 6px;
					}

					.cart-item-tags {
						display: flex;
						flex-wrap: wrap;
						gap: 4px;
						margin-bottom: 4px;
					}

					.cart-item-tag {
						font-size: 10px;
						padding: 2px 6px;
						border-radius: 4px;
						display: inline-flex;
						align-items: center;
						gap: 2px;
					}

					.cart-item-tag.strength {
						background: var(--bg-card);
						color: var(--text-muted);
					}

					.cart-item-tag.dosage-form {
						background: rgba(99, 102, 241, 0.1);
						color: var(--primary);
					}

					.cart-item-tag.prescription {
						background: rgba(16, 185, 129, 0.1);
						color: var(--success);
					}

					.cart-item-strength {
						font-size: 11px;
						color: var(--text-muted);
						background: var(--bg-card);
						padding: 2px 6px;
						border-radius: 4px;
						display: inline-block;
						margin-right: 4px;
					}

					.cart-item-dosage {
						font-size: 11px;
						color: var(--success);
						background: rgba(16, 185, 129, 0.1);
						padding: 2px 6px;
						border-radius: 4px;
						display: inline-block;
					}

					.cart-item-comment {
						font-size: 11px;
						color: var(--warning);
						font-style: italic;
						margin-top: 6px;
						padding: 6px 8px;
						background: rgba(245, 158, 11, 0.1);
						border-radius: 6px;
						border-left: 2px solid var(--warning);
					}

					.cart-item-remove {
						background: transparent;
						color: var(--text-muted);
						border: none;
						width: 28px;
						height: 28px;
						border-radius: 6px;
						cursor: pointer;
						font-size: 16px;
						transition: all 0.2s ease;
					}

					.cart-item-remove:hover {
						background: var(--danger);
						color: white;
					}

					.cart-item-controls {
						display: flex;
						justify-content: space-between;
						align-items: center;
					}

					.qty-controls {
						display: flex;
						align-items: center;
						gap: 4px;
						background: var(--bg-card);
						padding: 4px;
						border-radius: 8px;
					}

					.qty-btn {
						background: var(--primary);
						color: white;
						border: none;
						width: 28px;
						height: 28px;
						border-radius: 6px;
						cursor: pointer;
						font-size: 16px;
						font-weight: 600;
						transition: all 0.2s ease;
					}

					.qty-btn:hover {
						background: var(--primary-dark);
					}

					.qty-value {
						min-width: 40px;
						text-align: center;
						font-weight: 600;
						font-size: 14px;
						color: var(--text-primary);
					}

					.cart-item-total {
						font-weight: 700;
						color: var(--success);
						font-size: 15px;
					}

					.cart-empty {
						text-align: center;
						padding: 60px 20px;
						color: var(--text-muted);
					}

					.cart-empty-icon {
						width: 80px;
						height: 80px;
						background: var(--bg-elevated);
						border-radius: 50%;
						display: flex;
						align-items: center;
						justify-content: center;
						margin: 0 auto 16px;
						font-size: 32px;
						border: 1px solid var(--border-color);
					}

					.cart-empty-text {
						font-size: 16px;
						font-weight: 600;
						color: var(--text-secondary);
						margin-bottom: 8px;
					}

					.cart-empty-hint {
						font-size: 13px;
						color: var(--text-muted);
					}

					.cart-totals {
						background: var(--bg-elevated);
						padding: 20px;
						border-top: 1px solid var(--border-color);
						margin-top: auto;
						flex-shrink: 0;
					}

					.total-row {
						display: flex;
						justify-content: space-between;
						margin-bottom: 10px;
						font-size: 14px;
						color: var(--text-secondary);
					}

					.total-row.grand-total {
						font-size: 22px;
						font-weight: 700;
						color: var(--text-primary);
						padding-top: 14px;
						border-top: 1px solid var(--border-color);
						margin-top: 14px;
						margin-bottom: 20px;
					}

					.total-row.grand-total span:last-child {
						color: var(--success);
					}

					.checkout-button {
						width: 100%;
						padding: 16px;
						background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
						color: white;
						border: none;
						border-radius: 12px;
						font-size: 16px;
						font-weight: 700;
						cursor: pointer;
						transition: all 0.3s ease;
						text-transform: uppercase;
						letter-spacing: 0.5px;
						display: flex;
						align-items: center;
						justify-content: center;
						gap: 8px;
						box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
					}

					.checkout-button:hover:not(:disabled) {
						transform: translateY(-2px);
						box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
					}

					.checkout-button:disabled {
						background: var(--bg-elevated);
						color: var(--text-muted);
						cursor: not-allowed;
						box-shadow: none;
					}

					/* ===== ORDERS VIEW ===== */
					.orders-header-fixed {
						background: var(--bg-card);
						padding: 20px;
						border-bottom: 1px solid var(--border-color);
					}

					.orders-header {
						display: flex;
						justify-content: space-between;
						align-items: center;
					}

					.daily-total {
						background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
						color: white;
						padding: 8px 16px;
						border-radius: 8px;
						font-size: 14px;
						font-weight: 600;
					}

					.orders-list-wrapper {
						flex: 1;
						overflow-y: auto;
						padding: 16px;
					}

					.order-card {
						background: var(--bg-card);
						border-radius: 12px;
						padding: 16px;
						margin-bottom: 12px;
						border: 1px solid var(--border-color);
						border-left: 4px solid var(--primary);
						transition: all 0.2s ease;
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
					}

					.order-card:hover {
						border-color: var(--primary);
						box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
					}

					.order-card-header {
						display: flex;
						justify-content: space-between;
						align-items: flex-start;
						margin-bottom: 10px;
					}

					.order-number {
						font-weight: 700;
						font-size: 15px;
						color: var(--text-primary);
					}

					.order-status {
						padding: 4px 10px;
						border-radius: 6px;
						font-size: 11px;
						font-weight: 600;
						background: rgba(239, 68, 68, 0.1);
						color: var(--danger);
					}

					.order-status.completed {
						background: rgba(16, 185, 129, 0.1);
						color: var(--success);
					}

					.order-customer {
						font-size: 13px;
						color: var(--text-secondary);
						margin-bottom: 4px;
					}

					.order-meta {
						font-size: 12px;
						color: var(--text-muted);
						margin-bottom: 8px;
					}

					.order-footer {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding-top: 10px;
						border-top: 1px solid var(--border-color);
					}

					.order-date {
						font-size: 12px;
						color: var(--text-muted);
					}

					.order-amount {
						font-size: 16px;
						font-weight: 700;
						color: var(--success);
					}

					.order-actions {
						margin-top: 10px;
					}

					.order-cancel-btn {
						padding: 6px 12px;
						background: var(--danger);
						color: white;
						border: none;
						border-radius: 6px;
						font-size: 12px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
					}

					.order-cancel-btn:hover {
						background: #dc2626;
					}

					.orders-empty {
						text-align: center;
						padding: 60px 20px;
						color: var(--text-muted);
					}

					.orders-empty-icon {
						font-size: 48px;
						margin-bottom: 10px;
						opacity: 0.5;
					}

					/* ===== RESPONSIVE ===== */
					@media (max-width: 1200px) {
						.pos-body {
							grid-template-columns: 1fr;
						}

						.pos-cart-section {
							max-height: 400px;
						}
					}

					/* ===== FRAPPE OVERRIDES ===== */
					.pharmacy-pos-wrapper .frappe-control {
						margin-bottom: 0 !important;
					}

					.pharmacy-pos-wrapper .frappe-control input {
						background: var(--bg-card) !important;
						border-color: var(--border-color) !important;
						color: var(--text-primary) !important;
						border-radius: 10px !important;
					}

					.pharmacy-pos-wrapper .frappe-control input:focus {
						border-color: var(--primary) !important;
						box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
					}

					.pharmacy-pos-wrapper .link-btn {
						color: var(--text-muted) !important;
					}

					.pharmacy-pos-wrapper .awesomplete {
						position: relative;
						z-index: 1000;
					}

					.pharmacy-pos-wrapper .awesomplete > ul {
						background: var(--bg-card) !important;
						border-color: var(--border-color) !important;
						border-radius: 10px !important;
						box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1) !important;
						z-index: 1001 !important;
						position: absolute !important;
					}

					.pharmacy-pos-wrapper .awesomplete > ul > li {
						color: var(--text-primary) !important;
					}

					.pharmacy-pos-wrapper .awesomplete > ul > li:hover,
					.pharmacy-pos-wrapper .awesomplete > ul > li[aria-selected="true"] {
						background: var(--primary) !important;
						color: white !important;
					}
				</style>

				<div class="pos-header-section">
					<div class="pos-field" id="customer-field"></div>
					<div class="pos-field" id="patient-field"></div>
					<div class="pos-actions">
						<button class="pos-btn pos-btn-primary" id="load-medications-btn" disabled>
							💊 Load Prescriptions
						</button>
						<div class="orders-toggle" id="orders-toggle">
							<span class="toggle-label">My Orders</span>
							<div class="toggle-switch"></div>
						</div>
					</div>
				</div>

				<div class="pos-body">
					<div class="pos-items-section">
						<div class="search-section">
							<div class="search-wrapper">
								<input type="text" class="search-input" id="item-search" placeholder="Search medications by name, class, or abbreviation...">
							</div>
							<button class="reload-btn" id="reload-btn" title="Reload Medications">
								🔄
							</button>
							<div class="view-toggle" id="view-toggle">
								<button class="view-btn view-btn-grid active" data-view="grid">
									<span>🔲</span> Grid
								</button>
								<button class="view-btn view-btn-list" data-view="list">
									<span>📋</span> List
								</button>
							</div>
						</div>

						<div class="category-section" id="category-section">
							<div class="category-pill active" data-category="all">
								⭐ All
								<span class="category-count" id="count-all">0</span>
							</div>
							<div class="category-pill" data-category="in-stock">
								✅ In Stock
								<span class="category-count" id="count-in-stock">0</span>
							</div>
							<div class="category-pill" data-category="low-stock">
								⚠️ Low Stock
								<span class="category-count" id="count-low-stock">0</span>
							</div>
							<div class="category-pill" data-category="out-of-stock">
								❌ Out of Stock
								<span class="category-count" id="count-out-of-stock">0</span>
							</div>
						</div>

						<div class="items-container">
							<div class="items-grid" id="items-grid"></div>
						</div>

						<div class="items-footer">
							<div class="items-stats">
								<div class="stat-item">
									<span>Total:</span>
									<span class="stat-value" id="total-medications">0</span>
								</div>
								<div class="stat-item in-stock">
									<span>Available:</span>
									<span class="stat-value" id="available-medications">0</span>
								</div>
								<div class="stat-item out-of-stock">
									<span>Out of Stock:</span>
									<span class="stat-value" id="unavailable-medications">0</span>
								</div>
							</div>
							<div class="user-badge" id="user-badge">
								<div class="user-avatar" id="user-avatar">O</div>
								<span class="user-name"></span>
							</div>
						</div>
					</div>

					<div class="pos-cart-section" id="cart-section">
						<div class="cart-header" id="cart-header">
							<div class="cart-header-content">
								<div class="cart-title">
									🛒 Cart
									<span class="cart-count-badge" id="cart-count">0</span>
								</div>
								<button class="clear-cart-btn" id="clear-cart-btn">
									🗑️ Clear
								</button>
							</div>
						</div>
						<div class="cart-items-wrapper" id="cart-items"></div>
						<div id="orders-list-container" style="display: none;"></div>
						<div class="cart-totals" id="cart-totals">
							<div class="total-row">
								<span>Items:</span>
								<span id="items-count">0</span>
							</div>
							<div class="total-row">
								<span>Subtotal:</span>
								<span id="subtotal">₵0.00</span>
							</div>
							<div class="total-row grand-total">
								<span>Grand Total:</span>
								<span id="grand-total">₵0.00</span>
							</div>
							<button class="checkout-button" id="checkout-btn" disabled>
								💳 Complete Sale
							</button>
						</div>
					</div>
				</div>
			</div>
		`);
	}

	setup_fields() {
		this.customer_field = frappe.ui.form.make_control({
			parent: this.wrapper.find('#customer-field'),
			df: {
				fieldtype: 'Link',
				options: 'Customer',
				fieldname: 'customer',
				label: 'Customer',
				reqd: 1,
				default: 'Cash Customer',
				onchange: () => {
					this.customer = this.customer_field.get_value();
					this.update_ui();
				}
			},
			render_input: true
		});

		this.customer_field.set_value('Cash Customer');
		this.customer = 'Cash Customer';

		this.patient_field = frappe.ui.form.make_control({
			parent: this.wrapper.find('#patient-field'),
			df: {
				fieldtype: 'Link',
				options: 'Patient',
				fieldname: 'patient',
				label: 'Patient (Optional)',
				onchange: () => {
					this.patient = this.patient_field.get_value();
					if (this.patient) {
						this.customer_field.df.read_only = 1;
						this.customer_field.refresh();
						this.wrapper.find('#customer-field').css('opacity', '0.5');
					} else {
						this.customer_field.df.read_only = 0;
						this.customer_field.refresh();
						this.wrapper.find('#customer-field').css('opacity', '1');
					}
					this.update_ui();
				}
			},
			render_input: true
		});
	}

	bind_events() {
		this.wrapper.find('#item-search').on('input', (e) => {
			this.filter_items(e.target.value);
		});

		this.wrapper.find('#load-medications-btn').on('click', () => {
			this.load_patient_medications();
		});

		this.wrapper.find('#clear-cart-btn').on('click', () => {
			this.clear_cart();
		});

		this.wrapper.find('#orders-toggle').on('click', () => {
			this.toggle_orders_view();
		});

		this.wrapper.find('#checkout-btn').on('click', () => {
			this.checkout();
		});

		this.wrapper.find('#reload-btn').on('click', () => {
			this.reload_medications();
		});

		this.wrapper.find('.view-btn').on('click', (e) => {
			const view = $(e.currentTarget).data('view');
			this.set_view_mode(view);
		});

		// Category filter events
		this.wrapper.find('.category-pill').on('click', (e) => {
			const category = $(e.currentTarget).data('category');
			this.set_active_category(category);
		});

		// Barcode scanning
		let barcode_buffer = '';
		let barcode_timeout = null;

		$(document).on('keypress', (e) => {
			if (!this.wrapper.is(':visible')) return;
			if ($(e.target).is('input, textarea')) return;

			if (barcode_timeout) {
				clearTimeout(barcode_timeout);
			}

			if (e.key && e.key.length === 1) {
				barcode_buffer += e.key;
			}

			barcode_timeout = setTimeout(() => {
				if (barcode_buffer.length >= 3) {
					this.process_barcode(barcode_buffer);
				}
				barcode_buffer = '';
			}, 50);
		});
	}

	set_user_info() {
		const full_name = frappe.user.full_name() || frappe.session.user;
		this.wrapper.find('.user-name').text(full_name);
		
		// Set avatar initials
		const initials = full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
		this.wrapper.find('#user-avatar').text(initials);
	}

	update_ui() {
		const med_btn = this.wrapper.find('#load-medications-btn');
		if (this.patient) {
			med_btn.prop('disabled', false);
		} else {
			med_btn.prop('disabled', true);
		}

		this.update_checkout_button();
	}

	update_checkout_button() {
		const checkout_btn = this.wrapper.find('#checkout-btn');
		if ((this.customer || this.patient) && this.cart_items.length > 0) {
			checkout_btn.prop('disabled', false);
		} else {
			checkout_btn.prop('disabled', true);
		}
	}

	async load_data() {
		await this.load_items();
	}

	async reload_medications() {
		const reload_btn = this.wrapper.find('#reload-btn');
		reload_btn.addClass('loading');
		
		try {
			await this.load_items();
			frappe.show_alert({
				message: __('Medications reloaded successfully'),
				indicator: 'green'
			}, 2);
		} catch (error) {
			frappe.show_alert({
				message: __('Failed to reload medications'),
				indicator: 'red'
			}, 2);
		} finally {
			reload_btn.removeClass('loading');
		}
	}

	async load_items() {
		try {
			frappe.dom.freeze(__('Loading medications...'));

			// Single optimized server-side call that does everything
			const response = await frappe.call({
				method: 'ex_healthcare.api.pharmacy.get_pos_medications',
				args: {}
			});

			if (!response.message || response.message.length === 0) {
				this.medications = [];
				this.render_items();
				this.update_stats();
				frappe.dom.unfreeze();
				return;
			}

			this.medications = response.message;

			// Sort medications: in-stock first, then low-stock, then out-of-stock
			this.medications.sort((a, b) => {
				const a_stock = a.stock_qty || 0;
				const b_stock = b.stock_qty || 0;
				
				// Out of stock goes to bottom
				if (a_stock <= 0 && b_stock > 0) return 1;
				if (b_stock <= 0 && a_stock > 0) return -1;
				
				// Low stock (< 10) comes after normal stock
				if (a_stock < 10 && b_stock >= 10) return 1;
				if (b_stock < 10 && a_stock >= 10) return -1;
				
				// Sort by name within same stock category
				return a.generic_name.localeCompare(b.generic_name);
			});

			this.render_items();
			this.update_stats();
			frappe.dom.unfreeze();
		} catch (error) {
			frappe.dom.unfreeze();
			
			// Fallback to old method if custom API not available
			if (error.exc_type === 'DoesNotExistError' || error._server_messages) {
				console.warn('Custom API not found, using fallback method');
				await this.load_items_fallback();
			} else {
				frappe.msgprint(__('Failed to load medications'));
				console.error(error);
			}
		}
	}

	async load_items_fallback() {
		try {
			frappe.dom.freeze(__('Loading medications...'));

			const response = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Medication',
					filters: {
						disabled: 0
					},
					fields: [
						'name',
						'generic_name',
						'strength',
						'strength_uom',
						'medication_class',
						'abbr',
						'price_list',
						'default_dosage_form'
					],
					limit_page_length: 500
				}
			});

			if (!response.message || response.message.length === 0) {
				this.medications = [];
				this.render_items();
				this.update_stats();
				frappe.dom.unfreeze();
				return;
			}

			const med_names = response.message.map(m => m.name);
			
			// Fetch all medication details in parallel batches
			const batch_size = 100;
			const med_items_map = {};
			
			const all_batches = [];
			for (let i = 0; i < med_names.length; i += batch_size) {
				const batch = med_names.slice(i, i + batch_size);
				all_batches.push(
					frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Medication',
							filters: {
								name: ['in', batch]
							},
							fields: ['name', '`tabMedication Linked Item`.item as item', '`tabMedication Linked Item`.uom as uom'],
							limit_page_length: batch_size
						}
					}).then(result => {
						if (result.message) {
							result.message.forEach(med => {
								if (med.item && !med_items_map[med.name]) {
									med_items_map[med.name] = {
										item: med.item,
										uom: med.uom || 'Nos'
									};
								}
							});
						}
					}).catch(err => console.error('Batch error:', err))
				);
			}
			
			await Promise.all(all_batches);

			const item_codes = [...new Set(Object.values(med_items_map).map(m => m.item))];

			if (item_codes.length === 0) {
				this.medications = [];
				this.render_items();
				this.update_stats();
				frappe.dom.unfreeze();
				return;
			}

			// Fetch all data in parallel
			const price_lists = [...new Set(response.message.map(m => m.price_list).filter(p => p))];
			
			const [prices_response, stock_response, items_response] = await Promise.all([
				price_lists.length > 0 ? frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Item Price',
						filters: {
							item_code: ['in', item_codes],
							price_list: ['in', price_lists]
						},
						fields: ['item_code', 'price_list', 'price_list_rate'],
						limit_page_length: 1000
					}
				}) : Promise.resolve({ message: [] }),
				frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Bin',
						filters: {
							item_code: ['in', item_codes]
						},
						fields: ['item_code', 'sum(actual_qty) as total_qty'],
						group_by: 'item_code',
						limit_page_length: 1000
					}
				}),
				frappe.call({
					method: 'frappe.client.get_list',
					args: {
						doctype: 'Item',
						filters: {
							name: ['in', item_codes]
						},
						fields: ['name', 'standard_rate', 'image'],
						limit_page_length: 1000
					}
				})
			]);

			// Build lookup maps
			const prices_map = {};
			if (prices_response.message) {
				for (const price of prices_response.message) {
					const key = `${price.item_code}::${price.price_list}`;
					prices_map[key] = price.price_list_rate;
				}
			}

			const stock_map = {};
			if (stock_response.message) {
				for (const stock of stock_response.message) {
					stock_map[stock.item_code] = stock.total_qty || 0;
				}
			}

			const item_details_map = {};
			if (items_response.message) {
				for (const item of items_response.message) {
					item_details_map[item.name] = {
						standard_rate: item.standard_rate || 0,
						image: item.image || ''
					};
				}
			}

			this.medications = [];

			for (const med of response.message) {
				const linked_item = med_items_map[med.name];

				if (!linked_item) continue;

				let rate = 0;
				if (med.price_list) {
					const price_key = `${linked_item.item}::${med.price_list}`;
					rate = prices_map[price_key] || 0;
				}

				if (!rate) {
					rate = item_details_map[linked_item.item]?.standard_rate || 0;
				}

				const stock_qty = stock_map[linked_item.item] || 0;
				const item_image = item_details_map[linked_item.item]?.image || '';

				this.medications.push({
					medication_name: med.name,
					generic_name: med.generic_name,
					strength: med.strength,
					strength_uom: med.strength_uom,
					medication_class: med.medication_class,
					abbr: med.abbr,
					item_code: linked_item.item,
					rate: rate,
					stock_uom: linked_item.uom,
					stock_qty: stock_qty,
					dosage_form: med.default_dosage_form || '',
					image: item_image
				});
			}

			// Sort medications
			this.medications.sort((a, b) => {
				const a_stock = a.stock_qty || 0;
				const b_stock = b.stock_qty || 0;
				
				if (a_stock <= 0 && b_stock > 0) return 1;
				if (b_stock <= 0 && a_stock > 0) return -1;
				if (a_stock < 10 && b_stock >= 10) return 1;
				if (b_stock < 10 && a_stock >= 10) return -1;
				
				return a.generic_name.localeCompare(b.generic_name);
			});

			this.render_items();
			this.update_stats();
			frappe.dom.unfreeze();
		} catch (error) {
			frappe.dom.unfreeze();
			frappe.msgprint(__('Failed to load medications'));
			console.error(error);
		}
	}

	update_stats() {
		const total = this.medications.length;
		const in_stock = this.medications.filter(m => m.stock_qty > 10).length;
		const low_stock = this.medications.filter(m => m.stock_qty > 0 && m.stock_qty <= 10).length;
		const out_of_stock = this.medications.filter(m => m.stock_qty <= 0).length;

		this.wrapper.find('#total-medications').text(total);
		this.wrapper.find('#available-medications').text(in_stock + low_stock);
		this.wrapper.find('#unavailable-medications').text(out_of_stock);

		// Update category counts
		this.wrapper.find('#count-all').text(total);
		this.wrapper.find('#count-in-stock').text(in_stock);
		this.wrapper.find('#count-low-stock').text(low_stock);
		this.wrapper.find('#count-out-of-stock').text(out_of_stock);
	}

	set_active_category(category) {
		this.active_category = category;
		this.wrapper.find('.category-pill').removeClass('active');
		this.wrapper.find(`.category-pill[data-category="${category}"]`).addClass('active');
		this.filter_items(this.wrapper.find('#item-search').val());
	}

	get_filtered_medications() {
		if (!this.medications || this.medications.length === 0) {
        return [];
		}
		let items = [...this.medications];

		// Apply category filter
		switch (this.active_category) {
			case 'in-stock':
				items = items.filter(m => m.stock_qty > 10);
				break;
			case 'low-stock':
				items = items.filter(m => m.stock_qty > 0 && m.stock_qty <= 10);
				break;
			case 'out-of-stock':
				items = items.filter(m => m.stock_qty <= 0);
				break;
		}

		return items;
	}

	render_items(items = null) {
		const container = this.wrapper.find('#items-grid');
		container.empty();

		if (items === null) {
			items = this.get_filtered_medications();
		}

		if (!items || items.length === 0) {
			container.html(`
				<div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
					<div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">💊</div>
					<div style="font-size: 16px; font-weight: 600; color: var(--text-secondary);">No medications found</div>
					<div style="font-size: 13px; margin-top: 8px;">Try adjusting your search or filter</div>
				</div>
			`);
			return;
		}

		// Check view mode and render accordingly
		if (this.view_mode === 'list') {
			this.render_items_list(items, container);
		} else {
			this.render_items_grid(items, container);
		}
	}

	render_items_grid(items, container) {
		// Remove any list class and restore grid
		container.removeClass('items-list').addClass('items-grid');

		items.forEach(med => {
			const strength_display = med.strength && med.strength_uom ?
				`<span class="item-card-strength">${med.strength} ${med.strength_uom}</span>` : '';
			
			const dosage_form_display = med.dosage_form ?
				`<span class="item-card-dosage-form">${med.dosage_form}</span>` : '';

			const stock_qty = med.stock_qty || 0;
			let stock_class = '';
			let stock_badge = '';

			if (stock_qty <= 0) {
				stock_class = 'out-of-stock';
				stock_badge = '<div class="stock-badge out">Out of Stock</div>';
			} else if (stock_qty <= 10) {
				stock_class = 'low-stock';
				stock_badge = `<div class="stock-badge low">${stock_qty} left</div>`;
			} else {
				stock_badge = `<div class="stock-badge">${stock_qty} in stock</div>`;
			}

			// Image display - use item image if available, otherwise show emoji
			const image_content = med.image ? 
				`<img src="${med.image}" alt="${med.generic_name}" class="item-card-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
				<div class="item-card-img-fallback" style="display:none;">💊</div>` :
				`<div class="item-card-img-fallback">💊</div>`;

			const card = $(`
				<div class="item-card ${stock_class}" data-medication="${med.medication_name}">
					<div class="item-card-image">
						${image_content}
						${stock_badge}
					</div>
					<div class="item-card-content">
						<div class="item-card-name">${med.generic_name}</div>
						<div class="item-card-meta">${med.medication_class || 'General'}</div>
						<div class="item-card-tags">
							${strength_display}
							${dosage_form_display}
						</div>
						<div class="item-card-footer">
							<div class="item-card-price">₵${(med.rate || 0).toFixed(2)}</div>
						</div>
					</div>
				</div>
			`);

			if (stock_qty > 0) {
				card.on('click', () => this.add_item_to_cart(med));
			}

			container.append(card);
		});
	}

	render_items_list(items, container) {
		// Remove grid class and add list class
		container.removeClass('items-grid').addClass('items-list');

		items.forEach(med => {
			const stock_qty = med.stock_qty || 0;
			let stock_class = '';
			let stock_text = '';
			
			if (stock_qty <= 0) {
				stock_class = 'out-of-stock';
				stock_text = 'Out of Stock';
			} else if (stock_qty <= 10) {
				stock_class = 'low-stock';
				stock_text = `${stock_qty} left`;
			} else {
				stock_class = 'in-stock';
				stock_text = `${stock_qty} in stock`;
			}
			
			const image_content = med.image ? 
				`<img src="${med.image}" alt="${med.generic_name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
				<div style="width:100%;height:100%;display:none;align-items:center;justify-content:center;font-size:28px;">💊</div>` :
				`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;">💊</div>`;
			
			const strength_tag = med.strength && med.strength_uom ? 
				`<span class="item-list-tag">${med.strength} ${med.strength_uom}</span>` : '';
			
			const dosage_tag = med.dosage_form ? 
				`<span class="item-list-tag">${med.dosage_form}</span>` : '';
			
			const row = $(`
				<div class="item-list-row ${stock_qty <= 0 ? 'out-of-stock' : ''}" data-medication="${med.medication_name}">
					<div class="item-list-image">${image_content}</div>
					<div class="item-list-details">
						<div class="item-list-name">${med.generic_name}</div>
						<div class="item-list-meta">${med.medication_class || 'General'}</div>
						<div class="item-list-tags">
							${strength_tag}
							${dosage_tag}
						</div>
					</div>
					<div class="item-list-class">${med.medication_class || '-'}</div>
					<div class="item-list-stock ${stock_class}">${stock_text}</div>
					<div class="item-list-price">₵${(med.rate || 0).toFixed(2)}</div>
					<button class="item-list-add-btn" ${stock_qty <= 0 ? 'disabled' : ''}>
						+ Add
					</button>
				</div>
			`);
			
			if (stock_qty > 0) {
				row.find('.item-list-add-btn').on('click', (e) => {
					e.stopPropagation();
					this.add_item_to_cart(med);
				});
				
				// Allow clicking anywhere on the row
				row.on('click', function(e) {
					if (!$(e.target).hasClass('item-list-add-btn')) {
						$(this).find('.item-list-add-btn').click();
					}
				});
			}
			
			container.append(row);
		});
	}
	filter_items(query) {
		let items = this.get_filtered_medications();

		if (query) {
			const search_text = query.toLowerCase();
			items = items.filter(med => {
				return med.generic_name.toLowerCase().includes(search_text) ||
					(med.abbr && med.abbr.toLowerCase().includes(search_text)) ||
					(med.medication_class && med.medication_class.toLowerCase().includes(search_text));
			});
		}

		this.render_items(items);
	}

	async load_patient_medications() {
		if (!this.patient) {
			frappe.msgprint(__('Please select a patient'));
			return;
		}

		// CLEAR CART FIRST
		this.cart_items = [];
		this.render_cart();


		try {
			frappe.dom.freeze(__('Loading medications...'));

			const response = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Medication Request',
					filters: {
						patient: this.patient,
						docstatus: 1,
						status: 'active-Medication Request Status',
						billing_status: ['in', ['Pending', 'Partly Invoiced']]
					},
					fields: [
						'name', 'medication', 'medication_item', 'quantity',
						'qty_invoiced', 'total_dispensable_quantity',
						'dosage_form', 'dosage', 'period', 'comment'
					],
					limit_page_length: 100
				}
			});

			if (!response.message || response.message.length === 0) {
				frappe.msgprint(__('No pending medication requests found'));
				frappe.dom.unfreeze();
				return;
			}

			const out_of_stock_meds = new Set();
			let added_count = 0;

			for (const med_req of response.message) {
				const result = await this.add_medication_to_cart(med_req);
				if (result === 'out_of_stock') {
					out_of_stock_meds.add(med_req.medication);
				} else if (result === 'added') {
					added_count++;
				}
			}

			frappe.dom.unfreeze();

			if (out_of_stock_meds.size > 0) {
				frappe.msgprint({
					title: __('Medications Loaded with Warnings'),
					message: __('Loaded {0} medication(s).<br><br>The following medications are out of stock and were not added:<br><br><b>{1}</b>',
						[added_count, Array.from(out_of_stock_meds).join('<br>')]),
					indicator: 'orange'
				});
			} else if (added_count > 0) {
				frappe.show_alert({
					message: __('Loaded {0} medication(s)', [added_count]),
					indicator: 'green'
				});
			}
		} catch (error) {
			frappe.dom.unfreeze();
			frappe.msgprint(__('Failed to load medications'));
			console.error(error);
		}
	}

	async add_medication_to_cart(med_req) {
		try {
			const remaining_qty = (med_req.total_dispensable_quantity || med_req.quantity) -
				(med_req.qty_invoiced || 0);

			if (remaining_qty <= 0) return 'already_invoiced';

			const med = this.medications.find(m => m.medication_name === med_req.medication);

			if (!med) {
				console.warn(`Medication ${med_req.medication} not found in loaded list`);
				return 'not_found';
			}

			if (med.stock_qty <= 0) {
				return 'out_of_stock';
			}

			this.add_item_to_cart({
				medication_name: med.medication_name,
				generic_name: med.generic_name,
				strength: med.strength,
				strength_uom: med.strength_uom,
				item_code: med.item_code,
				rate: med.rate,
				stock_uom: med.stock_uom,
				medication_request: med_req.name,
				dosage_form: med_req.dosage_form || med.dosage_form,
				dosage: med_req.dosage,
				period: med_req.period,
				comment: med_req.comment,
				image: med.image
			}, remaining_qty);

			return 'added';

		} catch (error) {
			console.error('Error adding medication:', error);
			return 'error';
		}
	}

	async check_oversell_allowed() {
		const response = await frappe.call({
			method: 'frappe.client.get_single_value',
			args: {
				doctype: 'Ex Healthcare Settings',
				field: 'allow_oversell_medication'
			}
		});
		return response.message || false;
	}

	add_item_to_cart(med, qty = 1) {
		const med_in_list = this.medications.find(m => m.item_code === med.item_code);

		if (med_in_list) {
			const available_stock = med_in_list.stock_qty || 0;

			if (available_stock <= 0) {
				frappe.msgprint({
					title: __('Out of Stock'),
					message: __('Medication {0} is out of stock and cannot be added to cart', [med.generic_name || med.item_name]),
					indicator: 'red'
				});
				return;
			}

			const existing = this.cart_items.find(i => i.item_code === med.item_code &&
				i.medication_request === (med.medication_request || ''));
			const current_cart_qty = existing ? existing.qty : 0;
			const total_qty = current_cart_qty + qty;

			if (total_qty > available_stock) {
				frappe.msgprint({
					title: __('Insufficient Stock'),
					message: __('Only {0} units available for {1}. You are trying to add {2} units.',
						[available_stock, med.generic_name || med.item_name, total_qty]),
					indicator: 'orange'
				});
				return;
			}
		}

		const existing = this.cart_items.find(i => i.item_code === med.item_code &&
			i.medication_request === (med.medication_request || ''));

		if (existing) {
			existing.qty += qty;
		} else {
			this.cart_items.push({
				medication_name: med.medication_name || med.name,
				item_code: med.item_code,
				item_name: med.generic_name || med.item_name,
				rate: med.rate || 0,
				qty: qty,
				uom: med.stock_uom || 'Nos',
				strength: med.strength ? `${med.strength} ${med.strength_uom || ''}`.trim() : '',
				strength_uom: med.strength_uom || '',
				medication_request: med.medication_request || '',
				dosage_form: med.dosage_form || '',
				dosage: med.dosage || '',
				period: med.period || '',
				comment: med.comment || '',
				is_medication: true,
				stock_qty: med_in_list ? med_in_list.stock_qty : 0,
				image: med.image || (med_in_list ? med_in_list.image : '') || ''
			});
		}

		this.render_cart();
		this.update_checkout_button();
	}

	render_cart() {
		const cart_container = this.wrapper.find('#cart-items');
		cart_container.empty();

		if (this.cart_items.length === 0) {
			cart_container.html(`
				<div class="cart-empty">
					<div class="cart-empty-icon">🛒</div>
					<div class="cart-empty-text">Your cart is empty</div>
					<div class="cart-empty-hint">Click items to add them</div>
				</div>
			`);
			this.update_totals();
			return;
		}

		this.cart_items.forEach((item, index) => {
			const item_total = item.qty * item.rate;
			
			// Strength display
			const strength_html = item.strength ?
				`<span class="cart-item-tag strength">💊 ${item.strength}</span>` : '';
			
			// Dosage form display (from medication)
			const dosage_form_html = item.dosage_form ?
				`<span class="cart-item-tag dosage-form">📦 ${item.dosage_form}</span>` : '';

			// Prescription details (dosage, period) - different from dosage_form
			let prescription_html = '';
			if (item.dosage || item.period) {
				const parts = [];
				if (item.dosage) parts.push(item.dosage);
				if (item.period) parts.push(item.period);
				prescription_html = `<span class="cart-item-tag prescription">📋 ${parts.join(' • ')}</span>`;
			}

			const comment_html = item.comment ?
				`<div class="cart-item-comment">💬 ${item.comment}</div>` : '';

			// Image display
			const image_html = item.image ?
				`<img src="${item.image}" alt="${item.item_name}" class="cart-item-image" onerror="this.style.display='none';">` :
				`<div class="cart-item-image-placeholder">💊</div>`;

			const item_html = $(`
				<div class="cart-item">
					<div class="cart-item-row">
						<div class="cart-item-image-wrapper">
							${image_html}
						</div>
						<div class="cart-item-details">
							<div class="cart-item-name">${item.item_name}</div>
							<div class="cart-item-tags">
								${strength_html}
								${dosage_form_html}
								${prescription_html}
							</div>
							${comment_html}
						</div>
						<button class="cart-item-remove" data-index="${index}">×</button>
					</div>
					<div class="cart-item-controls">
						<div class="qty-controls">
							<button class="qty-btn qty-minus" data-index="${index}">−</button>
							<div class="qty-value">${item.qty}</div>
							<button class="qty-btn qty-plus" data-index="${index}">+</button>
						</div>
						<div class="cart-item-total">₵${item_total.toFixed(2)}</div>
					</div>
				</div>
			`);

			item_html.find('.qty-minus').on('click', () => this.update_qty(index, -1));
			item_html.find('.qty-plus').on('click', () => this.update_qty(index, 1));
			item_html.find('.cart-item-remove').on('click', () => this.remove_item(index));

			cart_container.append(item_html);
		});

		this.update_totals();
	}

	update_qty(index, change) {
		if (this.cart_items[index]) {
			const item = this.cart_items[index];
			const new_qty = Math.max(1, item.qty + change);

			if (change > 0) {
				const med_in_list = this.medications.find(m => m.item_code === item.item_code);

				if (med_in_list) {
					const available_stock = med_in_list.stock_qty || 0;

					if (new_qty > available_stock) {
						frappe.msgprint({
							title: __('Insufficient Stock'),
							message: __('Only {0} units available for {1}', [available_stock, item.item_name]),
							indicator: 'orange'
						});
						return;
					}
				}
			}

			this.cart_items[index].qty = new_qty;
			this.render_cart();
		}
	}

	remove_item(index) {
		this.cart_items.splice(index, 1);
		this.render_cart();
		this.update_checkout_button();
	}

	update_totals() {
		const total_items = this.cart_items.reduce((sum, item) => sum + item.qty, 0);
		const grand_total = this.cart_items.reduce((sum, item) => sum + (item.qty * item.rate), 0);

		this.wrapper.find('#cart-count').text(this.cart_items.length);
		this.wrapper.find('#items-count').text(total_items);
		this.wrapper.find('#subtotal').text(`₵${grand_total.toFixed(2)}`);
		this.wrapper.find('#grand-total').text(`₵${grand_total.toFixed(2)}`);
	}

	clear_cart() {
		if (this.cart_items.length === 0) return;

		frappe.confirm(
			__('Are you sure you want to clear the cart?'),
			() => {
				this.cart_items = [];
				this.render_cart();
				this.update_checkout_button();
				frappe.show_alert({
					message: __('Cart cleared'),
					indicator: 'orange'
				});
			}
		);
	}

	async checkout() {
		if (!this.patient && !this.customer) {
			frappe.msgprint(__('Please select a customer or patient'));
			return;
		}

		if (this.cart_items.length === 0) {
			frappe.msgprint(__('Cart is empty'));
			return;
		}

		const sale_to = this.patient || this.customer;

		frappe.confirm(
			__('Confirm sale to <b>{0}</b>?<br><br>Total Amount: <b>₵{1}</b>', [
				sale_to,
				this.cart_items.reduce((sum, item) => sum + (item.qty * item.rate), 0).toFixed(2)
			]),
			async () => {
				await this.process_checkout();
			}
		);
	}

	async process_checkout() {
		const out_of_stock_items = [];
		const insufficient_stock_items = [];
		const exceeded_medication_request_items = [];

		// Check if overselling is allowed
		const allow_oversell = await this.check_oversell_allowed();

		for (const cart_item of this.cart_items) {
			// ONLY check medication request quantities if overselling is NOT allowed
			if (cart_item.medication_request && !allow_oversell) {
				try {
					const med_req_response = await frappe.call({
						method: 'frappe.client.get',
						args: {
							doctype: 'Medication Request',
							name: cart_item.medication_request
						}
					});

					if (med_req_response.message) {
						const med_req = med_req_response.message;
						const remaining_qty = (med_req.total_dispensable_quantity || med_req.quantity) -
							(med_req.qty_invoiced || 0);

						if (cart_item.qty > remaining_qty) {
							exceeded_medication_request_items.push({
								name: cart_item.item_name,
								requested: cart_item.qty,
								allowed: remaining_qty,
								medication_request: cart_item.medication_request
							});
						}
					}
				} catch (error) {
					console.error('Error fetching Medication Request:', error);
					exceeded_medication_request_items.push({
						name: cart_item.item_name,
						requested: cart_item.qty,
						allowed: 0,
						medication_request: cart_item.medication_request,
						error: true
					});
				}
			}

			// Stock checks
			const med_in_list = this.medications.find(m => m.item_code === cart_item.item_code);

			if (med_in_list) {
				const available_stock = med_in_list.stock_qty || 0;

				if (available_stock <= 0) {
					out_of_stock_items.push(cart_item.item_name);
				} else if (cart_item.qty > available_stock) {
					insufficient_stock_items.push({
						name: cart_item.item_name,
						requested: cart_item.qty,
						available: available_stock
					});
				}
			}
		}

		// ONLY show exceeded medication request error if overselling is NOT allowed
		if (!allow_oversell && exceeded_medication_request_items.length > 0) {
			const details = exceeded_medication_request_items.map(item => {
				if (item.error) {
					return `<b>${item.name}</b>: Unable to verify Medication Request quantity`;
				} else {
					return `<b>${item.name}</b>: You're trying to sell ${item.requested} units when Medication Request (${item.medication_request}) was prescribed for ${item.allowed} units only.`;
				}
			}).join('<br>');

			frappe.msgprint({
				title: __('Medication Request Quantity Exceeded'),
				message: __('The following items exceed the allowed quantity from their Medication Requests:<br><br>{0}<br><br>Please adjust quantities to match the prescribed amounts.', [details]),
				indicator: 'red'
			});
			return;
		}

		if (out_of_stock_items.length > 0) {
			frappe.msgprint({
				title: __('Out of Stock'),
				message: __('The following items are out of stock and cannot be sold:<br><br><b>{0}</b><br><br>Please remove them from the cart.',
					[out_of_stock_items.join('<br>')]),
				indicator: 'red'
			});
			return;
		}

		if (insufficient_stock_items.length > 0) {
			const details = insufficient_stock_items.map(item =>
				`<b>${item.name}</b>: Requested ${item.requested}, Available ${item.available}`
			).join('<br>');

			frappe.msgprint({
				title: __('Insufficient Stock'),
				message: __('The following items have insufficient stock:<br><br>{0}<br><br>Please adjust quantities.', [details]),
				indicator: 'orange'
			});
			return;
		}

		try {
			frappe.dom.freeze(__('Creating Sales Order...'));

			const items = this.cart_items.map(item => ({
				item_code: item.item_code,
				qty: item.qty,
				rate: item.rate,
				uom: item.uom,
				reserve_stock: 0,
				custom_reference_doctype: item.medication_request ? 'Medication Request' : null,
				custom_reference_name: item.medication_request || null
			}));

			const sales_order_doc = {
				doctype: 'Sales Order',
				transaction_date: frappe.datetime.get_today(),
				delivery_date: frappe.datetime.get_today(),
				custom_invoice_from: 'Pharmacy',
				items: items
			};

			if (this.patient) {
				sales_order_doc.custom_patient = this.patient;
				sales_order_doc.customer = this.patient;
			} else {
				sales_order_doc.customer = this.customer;
			}

			const response = await frappe.call({
				method: 'frappe.client.insert',
				args: {
					doc: sales_order_doc
				}
			});

			if (!response.message) {
				throw new Error('Failed to create Sales Order');
			}

			const sales_order_name = response.message.name;

			try {
				await frappe.call({
					method: 'frappe.client.submit',
					args: {
						doc: response.message
					}
				});
			} catch (submit_error) {
				frappe.dom.unfreeze();
				frappe.msgprint({
					title: __('Error'),
					message: __('Sales Order created but failed to submit: {0}', [submit_error.message]),
					indicator: 'orange'
				});
				console.error('Submit error:', submit_error);
				return;
			}

			// UPDATE MEDICATION REQUESTS - Use custom server-side method for safer updates
			const med_requests_to_update = this.cart_items
				.filter(item => item.medication_request)
				.map(item => ({
					name: item.medication_request,
					qty: item.qty
				}));

			if (med_requests_to_update.length > 0) {
				try {
					await frappe.call({
						method: 'ex_healthcare.api.pharmacy.update_medication_requests',
						args: {
							updates: med_requests_to_update,
							allow_oversell: allow_oversell
						}
					});
				} catch (update_error) {
					// Log the error but don't fail the entire process
					console.error('Error updating medication requests:', update_error);
					
					frappe.msgprint({
						title: __('Warning'),
						message: __('Sales Order {0} created successfully, but some Medication Requests could not be updated. Please update them manually if needed.', 
							[sales_order_name]),
						indicator: 'orange'
					});
				}
			}

			frappe.dom.unfreeze();

			frappe.show_alert({
				message: __('Order {0} created successfully', [sales_order_name]),
				indicator: 'green'
			}, 5);

			this.cart_items = [];
			this.patient_field.set_value('');
			this.patient = null;
			this.render_cart();
			this.update_checkout_button();
			await this.load_items();

		} catch (error) {
			frappe.dom.unfreeze();
			frappe.msgprint({
				title: __('Error'),
				message: __('Failed to create Sales Order: {0}', [error.message || 'Unknown error']),
				indicator: 'red'
			});
			console.error(error);
		}
	}

	async toggle_orders_view() {
		this.show_orders = !this.show_orders;

		const toggle = this.wrapper.find('#orders-toggle');
		const cart_section = this.wrapper.find('#cart-section');
		const cart_header = this.wrapper.find('#cart-header');
		const cart_items = this.wrapper.find('#cart-items');
		const cart_totals = this.wrapper.find('#cart-totals');
		const orders_container = this.wrapper.find('#orders-list-container');

		if (this.show_orders) {
			toggle.addClass('active');
			cart_section.addClass('orders-view');
			cart_header.hide();
			cart_items.hide();
			cart_totals.hide();
			orders_container.show();
			await this.load_user_orders();
		} else {
			toggle.removeClass('active');
			cart_section.removeClass('orders-view');
			cart_header.show();
			cart_items.show();
			cart_totals.show();
			orders_container.hide();
		}
	}

	async load_user_orders() {
		try {
			const orders_container = this.wrapper.find('#orders-list-container');
			orders_container.html('<div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading orders...</div>');

			const today = frappe.datetime.get_today();

			const response = await frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Sales Order',
					filters: {
						owner: frappe.session.user,
						custom_invoice_from: 'Pharmacy',
						transaction_date: today
					},
					fields: [
						'name', 'customer', 'custom_patient', 'transaction_date',
						'grand_total', 'docstatus', 'status', 'creation', 'owner'
					],
					order_by: 'creation desc',
					limit_page_length: 100
				}
			});

			if (!response.message || response.message.length === 0) {
				orders_container.html(`
					<div class="orders-empty">
						<div class="orders-empty-icon">📋</div>
						<div>No orders found</div>
					</div>
				`);
				return;
			}

			const today_completed = response.message
				.filter(order => {
					const order_date = frappe.datetime.str_to_obj(order.transaction_date);
					const today_obj = frappe.datetime.str_to_obj(today);
					return order.status === 'Completed' &&
						order_date.getTime() === today_obj.getTime();
				})
				.reduce((sum, order) => sum + (order.grand_total || 0), 0);

			this.render_orders(response.message, today_completed);

		} catch (error) {
			console.error('Error loading orders:', error);
			const orders_container = this.wrapper.find('#orders-list-container');
			orders_container.html(`
				<div class="orders-empty">
					<div class="orders-empty-icon">❌</div>
					<div>Failed to load orders</div>
				</div>
			`);
		}
	}

	render_orders(orders, daily_total) {
		const orders_container = this.wrapper.find('#orders-list-container');
		orders_container.empty();

		const header = $(`
			<div class="orders-header-fixed">
				<div class="orders-header">
					<div class="cart-title" style="color: var(--text-primary);">📋 My Sales Orders</div>
					<div class="daily-total">Today: ₵${daily_total.toFixed(2)}</div>
				</div>
			</div>
		`);

		orders_container.append(header);

		const wrapper = $('<div class="orders-list-wrapper"></div>');

		orders.forEach(order => {
			let status_class = '';
			let status_text = 'Draft';

			if (order.docstatus === 1) {
				if (order.status === 'Completed') {
					status_class = 'completed';
					status_text = 'Completed';
				} else {
					status_text = order.status;
				}
			} else if (order.docstatus === 2) {
				status_text = 'Cancelled';
			}

			const customer_display = order.custom_patient || order.customer;
			const creation_time = frappe.datetime.str_to_user(order.creation);
			const creation_date = frappe.datetime.str_to_user(order.transaction_date);

			const show_cancel = order.docstatus === 1 && order.status !== 'Completed' && order.status !== 'Cancelled';

			const order_card = $(`
				<div class="order-card">
					<div class="order-card-header">
						<div class="order-number">${order.name}</div>
						<div class="order-status ${status_class}">${status_text}</div>
					</div>
					<div class="order-customer">👤 ${customer_display}</div>
					<div class="order-meta">👨‍💼 ${order.owner} • 🕐 ${creation_time}</div>
					<div class="order-footer">
						<div class="order-date">📅 ${creation_date}</div>
						<div class="order-amount">₵${(order.grand_total || 0).toFixed(2)}</div>
					</div>
					${show_cancel ? '<div class="order-actions"><button class="order-cancel-btn">Cancel Order</button></div>' : ''}
				</div>
			`);

			if (show_cancel) {
				order_card.find('.order-cancel-btn').on('click', (e) => {
					e.stopPropagation();
					this.cancel_order(order.name);
				});
			}

			wrapper.append(order_card);
		});

		orders_container.append(wrapper);
	}

	async cancel_order(order_name) {
		frappe.confirm(
			__('Are you sure you want to cancel Sales Order <b>{0}</b>?', [order_name]),
			async () => {
				try {
					frappe.dom.freeze(__('Cancelling order...'));

					await frappe.call({
						method: 'frappe.client.cancel',
						args: {
							doctype: 'Sales Order',
							name: order_name
						}
					});

					frappe.dom.unfreeze();

					frappe.show_alert({
						message: __('Order cancelled successfully'),
						indicator: 'orange'
					}, 3);

					await this.load_user_orders();

				} catch (error) {
					frappe.dom.unfreeze();
					frappe.msgprint({
						title: __('Error'),
						message: __('Failed to cancel order: {0}', [error.message || 'Unknown error']),
						indicator: 'red'
					});
					console.error(error);
				}
			}
		);
	}

	async process_barcode(barcode) {
		try {
			barcode = barcode.trim();

			if (!barcode) return;

			const response = await frappe.call({
				method: 'ex_healthcare.api.pharmacy.get_item_by_barcode',
				args: {
					barcode: barcode
				}
			});

			const item_code = response.message;

			if (!item_code) {
				frappe.show_alert({
					message: __('Item not found for barcode: {0}', [barcode]),
					indicator: 'red'
				}, 2);
				return;
			}

			const med = this.medications.find(m => m.item_code === item_code);

			if (!med) {
				frappe.show_alert({
					message: __('Medication not found for item: {0}', [item_code]),
					indicator: 'orange'
				}, 2);
				return;
			}

			if (med.stock_qty <= 0) {
				frappe.show_alert({
					message: __('❌ {0} is out of stock', [med.generic_name]),
					indicator: 'red'
				}, 2);
				return;
			}

			this.add_item_to_cart(med);

			const existing = this.cart_items.find(i => i.item_code === med.item_code);
			const current_qty = existing ? existing.qty : 0;

			frappe.show_alert({
				message: __('✓ {0} added (Qty: {1})', [med.generic_name, current_qty]),
				indicator: 'green'
			}, 1.5);

		} catch (error) {
			frappe.show_alert({
				message: __('Error: {0}', [error.message || 'Unknown error']),
				indicator: 'red'
			}, 2);
			console.error('Barcode error:', error);
		}
	}

	load_view_preference() {
		// Load user's preferred view from localStorage
		const stored_view = localStorage.getItem('pharmacy_pos_view_mode');
		if (stored_view) {
			this.view_mode = stored_view;
		}
	}

	save_view_preference() {
		// Save user's preferred view to localStorage
		localStorage.setItem('pharmacy_pos_view_mode', this.view_mode);
	}

	set_view_mode(mode) {
		this.view_mode = mode;
		this.save_view_preference();
		
		// Update button states
		this.wrapper.find('.view-btn').removeClass('active');
		this.wrapper.find(`.view-btn-${mode}`).addClass('active');
		
		// Re-render items
		this.render_items();
	}
}

//# sourceURL=pharmacy_pos.js