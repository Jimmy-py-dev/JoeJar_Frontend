const CONFIG = {
    API_BASE: "http:/127.0.0.1:8000/api/v1",
    ENDPOINTS: {
        login: "/auth/login",
        refresh: "/auth/refresh",
        products: "/products/",
        sales: "/sales/",
        salesExport: "/sales/export",
        confirmSale: "/sales/confirm",
        buyers: "/sales/buyers",
        financialSummary: "/admin/financial-summary",
        updateBalance: "/admin/update_balance",
        recalculateReceivables: "/admin/balance/recalculate-receivables"
    }
};

let state = { products: [], cart: [], buyers: [], globalDiscount: 0, editingId: null, financial: null };

// --- GLOBAL UI HELPERS ---
window.notify = (msg, type = 'success') => {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        document.body.appendChild(toast);
    }
    toast.className = `fixed bottom-10 right-10 px-8 py-4 rounded-2xl text-white font-bold shadow-2xl z-[9999] transition-all duration-300 ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`;
    toast.innerText = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
    }, 3000);
};

// --- CORE API & AUTHENTICATION ---
async function apiCall(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.API_BASE}${endpoint}`;
    options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        'Content-Type': 'application/json'
    };

    let response = await fetch(url, options);

    if (response.status === 401 || response.status === 403) {
        const refToken = localStorage.getItem('refresh_token');
        if (!refToken) return forceLogout();

        const refreshRes = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.refresh}?token=${refToken}`, { method: 'POST' });
        if (refreshRes.ok) {
            const data = await refreshRes.json();
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            options.headers['Authorization'] = `Bearer ${data.access_token}`;
            return await fetch(url, options);
        } else return forceLogout();
    }
    return response;
}

window.forceLogout = () => {
    localStorage.clear();
    window.location.href = 'index.html';
};

function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

// --- ROUTER ---
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    const isLogin = path.includes('index.html');

    if (!localStorage.getItem('access_token') && !isLogin) return forceLogout();

    if (isLogin) initLogin();
    else {
        syncOfflineSales(); 
        if (path.includes('shop.html')) initShop();
        else if (path.includes('products.html')) initProducts();
        else if (path.includes('history.html')) initHistory();
        else if (path.includes('financial.html')) initFinancial();
        else if (path.endsWith('/')) window.location.href = 'shop.html';
    }
});

// --- INITIALIZERS ---
function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    if (localStorage.getItem('access_token')) window.location.href = 'shop.html';

    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerText = "Authenticating...";

        const res = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.login}`, { method: 'POST', body: new FormData(e.target) });
        if (res.ok) {
            const d = await res.json();
            localStorage.setItem('access_token', d.access_token);
            localStorage.setItem('refresh_token', d.refresh_token);
            window.location.href = 'shop.html';
        } else {
            notify("Invalid Credentials", "error");
            btn.disabled = false; btn.innerText = "Sign In";
        }
    };
}

async function initShop() {
    const [prodRes, buyerRes] = await Promise.all([
        apiCall(CONFIG.ENDPOINTS.products),
        apiCall(CONFIG.ENDPOINTS.buyers)
    ]);
    
    if (prodRes && prodRes.ok) { 
        state.products = await prodRes.json(); 
        renderShopGrid(); 
    }
    if (buyerRes && buyerRes.ok) { 
        state.buyers = await buyerRes.json(); 
        renderBuyerList(); 
    }
}

async function initProducts() {
    const res = await apiCall(CONFIG.ENDPOINTS.products);
    if (res && res.ok) { state.products = await res.json(); renderProductGrid(); }
    const form = document.getElementById('product-form');
    if (form) form.onsubmit = handleProductSave;
}

async function initHistory() {
    const methodEl = document.getElementById('history-filter');
    const searchEl = document.getElementById('history-search');
    const method = methodEl ? methodEl.value : '';
    const url = method ? `${CONFIG.ENDPOINTS.sales}?method=${encodeURIComponent(method)}` : CONFIG.ENDPOINTS.sales;

    const [salesRes, buyersRes] = await Promise.all([
        apiCall(url),
        apiCall(CONFIG.ENDPOINTS.buyers)
    ]);

    if (buyersRes && buyersRes.ok) state.buyers = await buyersRes.json();
    if (salesRes && salesRes.ok) {
        let sales = await salesRes.json();
        const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
        if (q) {
            sales = sales.filter(s => {
                const buyer = (s.buyer_name || '').toString().toLowerCase();
                const seller = (s.seller || '').toString().toLowerCase();
                const id = (s.id || '').toString();
                return buyer.includes(q) || seller.includes(q) || id.includes(q);
            });
        }
        renderHistoryList(sales);
    }
}

window.downloadSalesExcel = async (btn, purgePreviousMonths = false) => {
    const methodEl = document.getElementById('history-filter');
    const method = methodEl ? methodEl.value : '';
    const originalText = btn ? btn.innerText : '';
    const params = new URLSearchParams();
    if (method) params.set('method', method);
    if (purgePreviousMonths) params.set('purge_previous_months', 'true');
    const query = params.toString();
    const endpoint = query ? `${CONFIG.ENDPOINTS.salesExport}?${query}` : CONFIG.ENDPOINTS.salesExport;

    if (purgePreviousMonths) {
        const confirmed = window.confirm('Export sales and delete all sales before this month? This cannot be undone from the app.');
        if (!confirmed) return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Exporting...';
    }

    const res = await apiCall(endpoint);

    if (btn) {
        btn.disabled = false;
        btn.innerText = originalText;
    }

    if (!res || !res.ok) {
        notify('Failed to export sales', 'error');
        return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'sales-history.xlsx';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    const deletedCount = Number(res.headers.get('X-Deleted-Sales-Count') || 0);
    if (deletedCount > 0) {
        notify(`Excel ready. Deleted ${deletedCount} old sales.`, 'success');
        initHistory();
    } else {
        notify('Excel export ready', 'success');
    }
};

async function initFinancial() {
    const form = document.getElementById('balance-form');
    if (form) form.onsubmit = handleBalanceUpdate;
    await loadFinancialSummary();
}

async function loadFinancialSummary() {
    const res = await apiCall(CONFIG.ENDPOINTS.financialSummary);
    if (!res || !res.ok) {
        notify('Failed to load financial summary', 'error');
        return;
    }

    state.financial = await res.json();
    renderFinancialSummary();
}

function renderFinancialSummary() {
    if (!state.financial) return;

    const balanceInput = document.getElementById('balance-input');
    const balanceEl = document.getElementById('balance-on-hand');
    const receivablesEl = document.getElementById('receivables-total');
    const actualEl = document.getElementById('actual-balance');

    if (balanceEl) balanceEl.innerText = formatMoney(state.financial.balance_on_hand);
    if (receivablesEl) receivablesEl.innerText = formatMoney(state.financial.receivables);
    if (actualEl) actualEl.innerText = formatMoney(state.financial.actual_balance);
    if (balanceInput && document.activeElement !== balanceInput) {
        balanceInput.value = Number(state.financial.balance_on_hand || 0).toFixed(2);
    }
}

async function handleBalanceUpdate(e) {
    e.preventDefault();
    const input = document.getElementById('balance-input');
    const btn = e.target.querySelector('button[type="submit"]');
    const balance = Number(input ? input.value : 0);

    if (!Number.isFinite(balance)) {
        notify('Enter a valid balance', 'error');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Saving...';
    }

    const url = `${CONFIG.ENDPOINTS.updateBalance}?balance=${encodeURIComponent(balance)}`;
    const res = await apiCall(url, { method: 'PATCH' });

    if (btn) {
        btn.disabled = false;
        btn.innerText = 'Update Balance';
    }

    if (res && res.ok) {
        notify('Balance updated', 'success');
        await loadFinancialSummary();
    } else {
        notify('Failed to update balance', 'error');
    }
}

window.recalculateReceivables = async (btn) => {
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Syncing...';
    }

    const res = await apiCall(CONFIG.ENDPOINTS.recalculateReceivables, { method: 'POST' });

    if (btn) {
        btn.disabled = false;
        btn.innerText = 'Sync Receivables';
    }

    if (res && res.ok) {
        notify('Receivables synchronized', 'success');
        await loadFinancialSummary();
    } else {
        notify('Failed to sync receivables', 'error');
    }
};

// --- SYNC ENGINE ---
async function syncOfflineSales() {
    let queue = JSON.parse(localStorage.getItem('offline_sales') || '[]');
    if (!queue.length) return;

    for (let i = 0; i < queue.length; i++) {
        const payload = queue[i];
        
        // Correct endpoint targeted to fix 405 error
        const res = await apiCall(CONFIG.ENDPOINTS.confirmSale, { method: 'POST', body: JSON.stringify(payload) });
        
        if (res && res.ok) {
            let saleObj = null;
            try { saleObj = await res.json(); } catch (e) { /* ignore */ }
            
            // Only fire the receipt popup on the shop.html page
            if (window.location.pathname.includes('shop.html')) {
                // We combine payload (has names) with saleObj (has server generated ID & totals)
                const receiptData = { ...payload, ...saleObj };
                await showReceipt(receiptData);
            } else {
                notify('Sale confirmed', 'success');
            }
            
            queue.splice(i, 1); i--; 
        }
    }
    localStorage.setItem('offline_sales', JSON.stringify(queue));
    const buyerRes = await apiCall(CONFIG.ENDPOINTS.buyers);
    if (buyerRes && buyerRes.ok) { 
        state.buyers = await buyerRes.json(); 
        renderBuyerList(); 
    }
}

// Display receipt modal for a confirmed sale
async function showReceipt(sale) {
    let modal = document.getElementById('receipt-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receipt-modal';
        document.body.appendChild(modal);
    }

    // High z-index to stay on top of shop layout
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
    modal.style.display = 'flex';

    // Build items with name fallbacks
    const itemsHtml = (sale.items || []).map(i => {
        const name = i.name || i.item || i.product_name || 'Item';
        const qty = Number(i.quantity) || Number(i.qty) || 1;
        const unit = (i.price || i.unit_price_at_sale || i.unit_price || 0);
        return `
        <div class="flex justify-between text-sm mb-2">
            <div class="text-slate-700 font-medium">${name} <span class="text-xs text-slate-400">x${qty}</span></div>
            <div class="font-bold text-slate-900">$${(unit * qty).toFixed(2)}</div>
        </div>`;
    }).join('');

    modal.innerHTML = `
        <div class="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-100">
            <div class="text-center mb-6">
                <div class="text-3xl font-black text-slate-900 italic mb-1">O-LITE</div>
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Official Receipt</div>
            </div>

            <div class="flex justify-between text-[10px] font-black text-slate-400 uppercase mb-4">
                <span>ID: #${sale.id || 'N/A'}</span>
                <span>${new Date(sale.timestamp || Date.now()).toLocaleString()}</span>
            </div>

            <div class="bg-slate-50 p-4 rounded-2xl mb-6">
                <div class="text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest">Items</div>
                ${itemsHtml}
            </div>

            <div class="space-y-2 px-1">
                <div class="flex justify-between text-sm text-slate-500">
                    <span>Discount</span>
                    <span class="font-bold text-rose-500">-$${Number(sale.discount_value || sale.discount || 0).toFixed(2)}</span>
                </div>
                <div class="flex justify-between text-2xl font-black text-slate-900 pt-2 border-t border-dashed">
                    <span>Total</span>
                    <span>$${Number(sale.total_price || sale.total || 0).toFixed(2)}</span>
                </div>
            </div>

            <div class="mt-8 flex gap-3">
                <button id="receipt-print" class="flex-1 bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl hover:bg-slate-200 transition">Print</button>
                <button id="receipt-close" class="flex-1 bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition">Done</button>
            </div>
        </div>
    `;

    // Wire buttons
    modal.querySelector('#receipt-close').onclick = () => { modal.style.display = 'none'; };
    modal.querySelector('#receipt-print').onclick = () => { window.print(); };
}

// Confirm payment for a sale (Admin action) — show custom modal first
window.confirmPayment = (saleId, btn) => {
    showConfirmPaymentModal(saleId, btn);
};

async function showConfirmPaymentModal(saleId, triggerBtn) {
    const existing = document.getElementById('confirm-payment-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'confirm-payment-modal';
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4';

    modal.innerHTML = `
        <div class="bg-white p-8 lg:p-10 rounded-3xl lg:rounded-[3rem] shadow-2xl w-full max-w-sm text-center">
            <div class="text-4xl mb-2">💳</div>
            <h3 class="text-2xl font-black mb-2 text-slate-800">Confirm Payment</h3>
            <p class="text-slate-500 font-medium mb-6 text-sm lg:text-base">Mark sale #${saleId} as paid? This will update the payment status and generate a receipt.</p>
            <div class="flex gap-4">
                <button id="confirm-pay-cancel" class="flex-1 font-bold text-slate-400 hover:text-slate-600 py-3">Cancel</button>
                <button id="confirm-pay-confirm" class="flex-1 bg-amber-500 text-white py-3 lg:py-4 rounded-2xl font-black shadow-xl">Mark Paid</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#confirm-pay-cancel').onclick = () => modal.remove();
    modal.querySelector('#confirm-pay-confirm').onclick = async function () {
        const btn = this;
        btn.disabled = true; btn.innerText = 'Processing...';
        const res = await apiCall(`${CONFIG.ENDPOINTS.sales}${saleId}/confirm_payment`, { method: 'PATCH' });
        if (res && res.ok) {
            notify('Payment confirmed', 'success');
            try {
                const salesRes = await apiCall(CONFIG.ENDPOINTS.sales);
                if (salesRes && salesRes.ok) {
                    const sales = await salesRes.json();
                    const sale = sales.find(s => s.id === saleId) || null;
                    if (sale) await showReceipt(sale);
                }
            } catch (e) { /* ignore */ }
            initHistory();
            modal.remove();
        } else {
            btn.disabled = false; btn.innerText = 'Mark Paid';
            notify('Failed to confirm payment', 'error');
        }
    };
}

// --- SHOP & CART LOGIC ---
window.addToCart = (id) => {
    const p = state.products.find(x => x.id === id);
    const item = state.cart.find(i => i.product_id === id);
    if (item) item.quantity++; else state.cart.push({ ...p, product_id: p.id, quantity: 1 });
    renderCart();
};
window.updateCartPrice = (idx, val) => { state.cart[idx].price = parseFloat(val); renderCart(); };
window.updateCartQty = (idx, val) => { state.cart[idx].quantity = parseInt(val); renderCart(); };
window.removeFromCart = (idx) => { state.cart.splice(idx, 1); renderCart(); };
window.updateDiscount = (val) => { state.globalDiscount = parseFloat(val) || 0; renderCart(); };

// CUSTOM CONFIRMATION MODAL LOGIC
window.finalizeSale = () => {
    if (!state.cart.length) return;
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;
    const buyerInput = document.getElementById('buyer-name');
    const display = document.getElementById('confirm-buyer-name');
    if (display) display.innerText = buyerInput && buyerInput.value.trim() ? buyerInput.value.trim() : '(none)';

    modal.style.display = 'flex';
};

window.closeConfirmModal = () => {
    document.getElementById('confirm-modal').style.display = 'none';
};

window.executeSale = () => {
    closeConfirmModal();
    
    const buyerInput = document.getElementById('buyer-name');
    const inputValue = buyerInput ? buyerInput.value.trim() : "";
    
    let b_id = null;
    let b_name = null;
    if (inputValue) {
        const existing = getSelectedBuyer(inputValue);
        if (existing) {
            b_id = existing.id;
        } else {
            b_name = inputValue;
        }
    }

    const paymentEl = document.getElementById('payment-method');
    const payment_method = paymentEl ? paymentEl.value : 'cash';

    // We include the 'name' here so the receipt can read it before the server strips it
    const saleData = {
        items: state.cart.map(i => ({ 
            product_id: i.product_id, 
            quantity: i.quantity, 
            price: i.price,
            name: i.name 
        })),
        discount_value: state.globalDiscount,
        buyer_id: b_id,
        buyer_name: b_name,
        payment_method: payment_method
    };
    
    let queue = JSON.parse(localStorage.getItem('offline_sales') || '[]');
    queue.push(saleData);
    localStorage.setItem('offline_sales', JSON.stringify(queue));

    state.cart = []; 
    state.globalDiscount = 0;
    const discInput = document.getElementById('discount-input');
    if (discInput) discInput.value = 0;
    if (buyerInput) buyerInput.value = ""; 
    updateBuyerPreview();
    
    renderCart();
    notify("Sale Recorded!");
    syncOfflineSales();
};

function renderShopGrid() {
    const el = document.getElementById('product-grid');
    if (!el) return;
    el.innerHTML = state.products.map(p => `
        <div onclick="addToCart(${p.id})" class="bg-white p-6 rounded-[2rem] border-2 border-transparent hover:border-indigo-600 cursor-pointer shadow-sm transition-all active:scale-95">
            <div class="font-black text-slate-800 text-lg">${p.name}</div>
            <div class="text-indigo-600 font-black text-xl mt-1">$${p.price}</div>
        </div>
    `).join('');
}

function renderBuyerList() {
    const datalist = document.getElementById('buyer-datalist');
    if (!datalist) return;
    datalist.innerHTML = state.buyers.map(b => `<option value="${b.name}" data-id="${b.id}">`).join('');
    updateBuyerPreview();
}

function getSelectedBuyer(inputValue) {
    const normalized = (inputValue || '').trim().toLowerCase();
    if (!normalized) return null;
    return state.buyers.find(b => (b.name || '').trim().toLowerCase() === normalized) || null;
}

window.updateBuyerPreview = () => {
    const input = document.getElementById('buyer-name');
    const preview = document.getElementById('buyer-preview');
    if (!input || !preview) return;

    const value = input.value.trim();
    const existing = getSelectedBuyer(value);

    if (!value) {
        preview.innerText = 'Guest sale';
        preview.className = 'text-[10px] font-bold text-slate-400 mt-1';
    } else if (existing) {
        preview.innerText = `Existing buyer #${existing.id}`;
        preview.className = 'text-[10px] font-bold text-emerald-600 mt-1';
    } else {
        preview.innerText = 'New buyer';
        preview.className = 'text-[10px] font-bold text-amber-600 mt-1';
    }
};

function renderCart() {
    const list = document.getElementById('cart-list');
    if (!list) return;
    list.innerHTML = state.cart.map((item, idx) => `
        <div class="bg-slate-50 border p-4 rounded-2xl flex flex-col gap-2">
            <div class="flex justify-between font-bold text-sm text-slate-800">
                <span>${item.name}</span>
                <button onclick="removeFromCart(${idx})" class="text-rose-500 font-black">×</button>
            </div>
            <div class="flex gap-2">
                <input type="number" step="0.01" value="${item.price}" onchange="updateCartPrice(${idx}, this.value)" class="w-20 p-2 border rounded-lg text-xs font-bold text-indigo-600 outline-none">
                <input type="number" value="${item.quantity}" onchange="updateCartQty(${idx}, this.value)" class="w-16 p-2 border rounded-lg text-xs outline-none">
            </div>
        </div>
    `).join('');
    
    const total = state.cart.reduce((s, i) => s + (i.price * i.quantity), 0) - state.globalDiscount;
    const totalEl = document.getElementById('cart-total');
    if(totalEl) totalEl.innerText = Math.max(0, total).toFixed(2);

    const discInput = document.getElementById('discount-input');
    if (discInput) {
        if (discInput.value !== String(state.globalDiscount)) discInput.value = state.globalDiscount || 0;
    }
}

// --- PRODUCT ADMIN LOGIC ---
window.openProductModal = (id = null) => {
    state.editingId = id;
    const modal = document.getElementById('product-modal');
    const form = document.getElementById('product-form');
    modal.style.display = 'flex';
    
    if (id) {
        const p = state.products.find(x => x.id === id);
        form.name.value = p.name; form.price.value = p.price; form.stock_quantity.value = p.stock_quantity;
    } else form.reset();
};

window.closeProductModal = () => document.getElementById('product-modal').style.display = 'none';

async function handleProductSave(e) {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    payload.price = parseFloat(payload.price); payload.stock_quantity = parseInt(payload.stock_quantity);

    const isEdit = !!state.editingId;
    const url = isEdit ? `${CONFIG.ENDPOINTS.products}${state.editingId}` : CONFIG.ENDPOINTS.products;
    
    const res = await apiCall(url, { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    if (res && res.ok) {
        closeProductModal(); notify(isEdit ? "Product Updated" : "Product Saved"); initProducts();
    }
}

function renderProductGrid() {
    const el = document.getElementById('inv-grid');
    if (!el) return;
    el.innerHTML = state.products.map(p => `
        <div class="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col justify-between">
            <div>
                <div class="font-black text-slate-800 text-lg">${p.name}</div>
                <div class="text-indigo-600 font-black text-xl mt-1">$${p.price}</div>
                <div class="text-[10px] mt-2 text-slate-400 font-bold uppercase">Stock: ${p.stock_quantity}</div>
            </div>
            <button onclick="openProductModal(${p.id})" class="mt-6 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 rounded-xl transition w-full text-sm">
                Edit Details
            </button>
        </div>
    `).join('');
}

function renderHistoryList(data) {
    const el = document.getElementById('history-list');
    if (!el) return;
    
    el.innerHTML = data.map(s => {
        let buyerName = "Guest";
        if (s.buyer_name) {
            buyerName = s.buyer_name;
        } else if (s.buyer) {
            const foundBuyer = state.buyers.find(b => b.id === s.buyer);
            if (foundBuyer) buyerName = foundBuyer.name;
        }
        
        const itemsHtml = s.items.map(i => `
            <div class="flex justify-between text-xs text-slate-600 mt-2 border-b border-slate-200/50 pb-1 border-dashed">
                <span class="font-medium">${i.quantity}x ${i.item}</span>
                <span class="font-bold text-slate-400">$${(i.price * Number(i.quantity)).toFixed(2)}</span>
            </div>
        `).join('');

        return `
        <div class="bg-white p-5 md:p-6 rounded-3xl border mb-4 flex flex-col shadow-sm gap-4 hover:shadow-md transition">
            
            <div class="flex justify-between items-start border-b pb-4">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg uppercase tracking-wider">Order #${s.id}</span>
                        <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-bold uppercase">👤 ${buyerName}</span>
                    </div>
                    <div class="text-xs text-slate-400 font-bold uppercase">Cashier: <span class="text-slate-600">${s.seller}</span></div>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-black text-slate-800">${formatMoney(s.total)}</div>
                    ${s.discount > 0 ? `<div class="text-[10px] text-rose-500 font-bold mt-1 bg-rose-50 px-2 py-1 rounded-md inline-block">-$${s.discount.toFixed(2)} Discount</div>` : ''}
                    ${s.payment_status && s.payment_status !== 'paid' ? `<div class="mt-3"><button onclick="confirmPayment(${s.id}, this)" class="bg-amber-500 text-white py-2 px-3 rounded-lg font-bold">Mark Paid</button></div>` : `<div class="mt-3 inline-block bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold">${s.payment_status && s.payment_status.toUpperCase()}</div>`}
                </div>
            </div>
            
            <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Items Purchased</div>
                ${itemsHtml}
            </div>
            
            <div class="text-right text-xs text-slate-400 font-medium">
                ${new Date(s.timestamp).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            
        </div>
    `}).join('');
}
