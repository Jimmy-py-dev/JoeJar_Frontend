const CONFIG = {
    API_BASE: "https://joejar.onrender.com/api/v1",
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
let refreshPromise = null;

// --- GLOBAL UI HELPERS ---
window.notify = (msg, type = 'success') => {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        document.body.appendChild(toast);
    }
    toast.className = `fixed bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm px-5 py-4 rounded-2xl text-white font-bold shadow-2xl z-[9999] transition-all duration-300 ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`;
    toast.innerText = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
    }, 3000);
};

// --- CORE API & AUTHENTICATION ---
function clearAuthTokens() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
}

async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        const refToken = localStorage.getItem('refresh_token');
        if (!refToken) return null;

        try {
            const refreshRes = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.refresh}?token=${encodeURIComponent(refToken)}`, {
                method: 'POST'
            });

            if (!refreshRes.ok) {
                clearAuthTokens();
                return null;
            }

            const data = await refreshRes.json();
            if (!data.access_token) {
                clearAuthTokens();
                return null;
            }

            localStorage.setItem('access_token', data.access_token);
            if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
            return data.access_token;
        } catch (error) {
            return null;
        }
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

async function apiCall(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.API_BASE}${endpoint}`;
    const requestOptions = {
        ...options,
        headers: {
            ...(options.headers || {}),
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Content-Type': 'application/json'
        }
    };

    let response = await fetch(url, requestOptions);

    if (response.status === 401 || response.status === 403) {
        const accessToken = await refreshAccessToken();
        if (!accessToken) return forceLogout();

        requestOptions.headers['Authorization'] = `Bearer ${accessToken}`;
        response = await fetch(url, requestOptions);
        if (response.status === 401 || response.status === 403) return forceLogout();
    }
    return response;
}

window.forceLogout = () => {
    clearAuthTokens();
    window.location.href = 'index.html';
};

async function ensureAuthenticated() {
    if (localStorage.getItem('access_token')) return true;

    const accessToken = await refreshAccessToken();
    if (accessToken) return true;

    forceLogout();
    return false;
}

function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

// --- ROUTER ---
document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;
    const isLogin = path.includes('index.html');

    if (!isLogin && !(await ensureAuthenticated())) return;

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
    if (localStorage.getItem('access_token') && localStorage.getItem('refresh_token')) {
        window.location.href = 'shop.html';
        return;
    }
    if (localStorage.getItem('access_token') && !localStorage.getItem('refresh_token')) clearAuthTokens();

    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerText = "Signing in...";

        try {
            const res = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.login}`, { method: 'POST', body: new FormData(e.target) });
            if (res.ok) {
                const d = await res.json();
                if (!d.access_token || !d.refresh_token) {
                    notify("Login response is missing tokens", "error");
                    return;
                }
                localStorage.setItem('access_token', d.access_token);
                localStorage.setItem('refresh_token', d.refresh_token);
                window.location.href = 'shop.html';
            } else {
                notify("Invalid Credentials", "error");
            }
        } catch (error) {
            notify("Cannot reach server. Try again.", "error");
        } finally {
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
    renderCart();
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

// Display receipt modal for a confirmed sale or a pre-submit review.
function showReceipt(sale, options = {}) {
    const isReview = options.mode === 'review';
    let modal = document.getElementById('receipt-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receipt-modal';
        document.body.appendChild(modal);
    }

    // High z-index to stay on top of shop layout
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
    modal.style.display = 'flex';

    const items = sale.items || [];
    const discount = Number(sale.discount_value || sale.discount || 0);
    const subtotal = items.reduce((sum, i) => {
        const qty = Number(i.quantity) || Number(i.qty) || 1;
        const unit = Number(i.price || i.unit_price_at_sale || i.unit_price || 0);
        return sum + (unit * qty);
    }, 0);
    const total = Number(sale.total_price || sale.total || Math.max(0, subtotal - discount));

    // Build items with name fallbacks
    const itemsHtml = items.map(i => {
        const name = i.name || i.item || i.product_name || 'Item';
        const qty = Number(i.quantity) || Number(i.qty) || 1;
        const unit = Number(i.price || i.unit_price_at_sale || i.unit_price || 0);
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
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">${isReview ? 'Review Receipt' : 'Official Receipt'}</div>
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
                    <span class="font-bold text-rose-500">-$${discount.toFixed(2)}</span>
                </div>
                <div class="flex justify-between text-2xl font-black text-slate-900 pt-2 border-t border-dashed">
                    <span>Total</span>
                    <span>$${total.toFixed(2)}</span>
                </div>
            </div>

            <div class="mt-8 flex gap-3">
                <button id="receipt-cancel" class="flex-1 bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl hover:bg-slate-200 transition">${isReview ? 'Cancel' : 'Print'}</button>
                <button id="receipt-confirm" class="flex-1 bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition">${isReview ? 'Confirm Sale' : 'Done'}</button>
            </div>
        </div>
    `;

    if (!isReview) {
        modal.querySelector('#receipt-confirm').onclick = () => { modal.style.display = 'none'; };
        modal.querySelector('#receipt-cancel').onclick = () => { window.print(); };
        return;
    }

    return new Promise(resolve => {
        modal.querySelector('#receipt-cancel').onclick = () => {
            modal.style.display = 'none';
            resolve(false);
        };
        modal.querySelector('#receipt-confirm').onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };
    });
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
window.removeFromCart = (idx) => {
    state.cart.splice(idx, 1);
    renderCart();
    if (!state.cart.length) setCartOpen(false);
};
window.updateDiscount = (val) => { state.globalDiscount = parseFloat(val) || 0; renderCart(); };

function setCartOpen(open) {
    const panel = document.getElementById('cart-panel');
    if (!panel) return;

    panel.classList.toggle('cart-open', open);
    panel.classList.toggle('cart-collapsed', !open);

    const chevron = document.getElementById('cart-chevron');
    if (chevron) chevron.innerText = open ? 'Close' : 'Open';
}

window.toggleCart = () => {
    const panel = document.getElementById('cart-panel');
    if (!panel) return;
    setCartOpen(!panel.classList.contains('cart-open'));
};

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

window.executeSale = async () => {
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

    const confirmed = await showReceipt(saleData, { mode: 'review' });
    if (!confirmed) return;
    
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
        <button onclick="addToCart(${p.id})" class="text-left bg-white p-4 sm:p-5 lg:p-6 rounded-2xl border border-slate-200 hover:border-indigo-500 hover:shadow-md cursor-pointer shadow-sm transition-all active:scale-[0.98] min-h-28">
            <div class="font-black text-slate-800 text-base lg:text-lg leading-tight break-words">${p.name}</div>
            <div class="text-indigo-600 font-black text-lg lg:text-xl mt-2">$${p.price}</div>
            <div class="text-[10px] mt-3 text-slate-400 font-black uppercase tracking-widest">Tap to add</div>
        </button>
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
        <div class="bg-slate-50 border border-slate-200 p-3 sm:p-4 rounded-2xl flex flex-col gap-3">
            <div class="flex justify-between gap-3 font-bold text-sm text-slate-800">
                <span class="break-words leading-snug">${item.name}</span>
                <button onclick="removeFromCart(${idx})" class="text-rose-500 font-black text-xl leading-none px-2" aria-label="Remove item">&times;</button>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <label class="text-[10px] font-black text-slate-400 uppercase">Price<input type="number" step="0.01" value="${item.price}" onchange="updateCartPrice(${idx}, this.value)" class="mt-1 w-full p-2 border rounded-lg text-xs font-bold text-indigo-600 outline-none focus:border-indigo-500"></label>
                <label class="text-[10px] font-black text-slate-400 uppercase">Qty<input type="number" value="${item.quantity}" onchange="updateCartQty(${idx}, this.value)" class="mt-1 w-full p-2 border rounded-lg text-xs outline-none focus:border-indigo-500"></label>
            </div>
        </div>
    `).join('');
    
    const total = state.cart.reduce((s, i) => s + (i.price * i.quantity), 0) - state.globalDiscount;
    const safeTotal = Math.max(0, total);
    const totalEl = document.getElementById('cart-total');
    if(totalEl) totalEl.innerText = safeTotal.toFixed(2);

    const itemCount = state.cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const countEl = document.getElementById('cart-count');
    if (countEl) {
        const label = itemCount === 1 ? 'item' : 'items';
        countEl.innerText = `${itemCount} ${label} - ${formatMoney(safeTotal)}`;
    }

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
    const form = e.target;
    const modal = document.getElementById('product-modal');
    const btn = form.querySelector('button[type="submit"]');
    if (btn && btn.disabled) return;

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Saving...';
    }

    if (modal) modal.style.display = 'none';

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.price = parseFloat(payload.price); payload.stock_quantity = parseInt(payload.stock_quantity);

    const isEdit = !!state.editingId;
    const url = isEdit ? `${CONFIG.ENDPOINTS.products}${state.editingId}` : CONFIG.ENDPOINTS.products;
    
    try {
        const res = await apiCall(url, { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        if (res && res.ok) {
            form.reset();
            notify(isEdit ? "Product Updated" : "Product Saved");
            initProducts();
            return;
        }

        if (modal) modal.style.display = 'flex';
        notify('Failed to save product', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Save';
        }
    }
}

function renderProductGrid() {
    const el = document.getElementById('inv-grid');
    if (!el) return;
    el.innerHTML = state.products.map(p => `
        <div class="bg-white p-5 lg:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition">
            <div>
                <div class="font-black text-slate-800 text-lg break-words leading-tight">${p.name}</div>
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
        <div class="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 mb-4 flex flex-col shadow-sm gap-4 hover:shadow-md transition">
            
            <div class="flex flex-col sm:flex-row justify-between items-start gap-4 border-b pb-4">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                        <span class="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg uppercase tracking-wider">Order #${s.id}</span>
                        <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-bold uppercase break-all">${buyerName}</span>
                    </div>
                    <div class="text-xs text-slate-400 font-bold uppercase">Cashier: <span class="text-slate-600">${s.seller}</span></div>
                </div>
                <div class="w-full sm:w-auto sm:text-right">
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
