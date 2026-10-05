import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBP8B2KiK_EWxhLrRgeC6uxy1ItYQNbGC4",
    authDomain: "thunders-workshop.firebaseapp.com",
    projectId: "thunders-workshop",
    storageBucket: "thunders-workshop.firebasestorage.app",
    messagingSenderId: "41571220343",
    appId: "1:41571220343:web:ab370784eb0bb09810ff72",
    measurementId: "G-MBLS2GL06X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const API_URL = 'https://thunder-backend-esf1.onrender.com/api';

let isAdminUnlocked = false; 
let currentUserToken = null; 

let masterTransactions = [];
let masterAuditLogs = [];
let currentFilteredData = []; 

let currentPage = 1;
const rowsPerPage = 50;
const noPaginationViews = ['This Month', 'This Week', 'Category Month', 'All Month'];

let currentViews = { 'expense-section': 'This Month', 'cash-section': 'This Month', 'bank-section': 'This Month' };
let currentSorts = { 'expense-section': 'date-desc', 'cash-section': 'date-desc', 'bank-section': 'date-desc' };
let currentSubFilters = { 'expense-section': '', 'cash-section': '', 'bank-section': '' };

let categoryChartInst = null;
let cashflowChartInst = null;

let deepCleanTimer;
let timeLeft = 3600;

function getAuthHeaders(isJson = false) {
    const headers = { 'Authorization': `Bearer ${currentUserToken}` };
    if (isJson) headers['Content-Type'] = 'application/json';
    return headers;
}

function enforceDateRules() {
    const now = new Date();
    const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const dateInput = document.getElementById('date');
    if (dateInput) { dateInput.max = localDate; if (!dateInput.value) dateInput.value = localDate; }
    const editDateInput = document.getElementById('edit-date');
    if (editDateInput) editDateInput.max = localDate;
    return localDate;
}

window.openTab = function(evt, tabName) {
    let tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) tabContents[i].classList.remove("active");
    
    let tabBtns = document.getElementsByClassName("tab-btn");
    for (let i = 0; i < tabBtns.length; i++) tabBtns[i].classList.remove("active");
    
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");

    if (currentSorts[tabName]) {
        const globalSortEl = document.getElementById('global-sort');
        if(globalSortEl) globalSortEl.value = currentSorts[tabName];
    }

    if (tabName === 'search-section') {
        document.getElementById('pagination-controls').style.display = 'none';
        runUniversalSearch();
    } else if (tabName === 'dashboard-section') {
        document.getElementById('pagination-controls').style.display = 'none';
        renderDashboard();
    } else {
        processAndRenderTables();
    }
}

window.changeGlobalSort = function(val) {
    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;
    currentSorts[activeTab] = val;
    currentPage = 1;
    processAndRenderTables();
}

window.setView = function(tabId, viewName, btnElement) {
    currentViews[tabId] = viewName;
    currentSubFilters[tabId] = ''; 
    const container = btnElement.parentElement;
    container.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    updateSubFilterUI(tabId, viewName);
    currentPage = 1;
    processAndRenderTables();
}

function updateSubFilterUI(tabId, viewName) {
    const container = document.getElementById(`sub-filter-container-${tabId}`);
    if (!container) return;
    
    if (viewName === 'Category' || viewName === 'Category Month') {
        let cats = [...new Set(masterTransactions.map(t => t.category).filter(Boolean))].sort();
        let catOptions = `<option value="">Select Category...</option>`;
        cats.forEach(c => catOptions += `<option value="${c}">${c}</option>`);
        container.innerHTML = `<select class="sub-filter-select" onchange="changeSubFilter('${tabId}', this.value)">${catOptions}</select>`;
        container.style.display = 'block';
    } 
    else if (viewName === 'All Month') {
        let months = [...new Set(masterTransactions.map(t => t.date.substring(0, 7)))].sort().reverse();
        let monthOptions = `<option value="">Select Month...</option>`;
        months.forEach(m => {
            let dateObj = new Date(m + "-01");
            let label = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
            monthOptions += `<option value="${m}">${label}</option>`;
        });
        container.innerHTML = `<select class="sub-filter-select" onchange="changeSubFilter('${tabId}', this.value)">${monthOptions}</select>`;
        container.style.display = 'block';
    } 
    else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

window.changeSubFilter = function(tabId, val) { currentSubFilters[tabId] = val; currentPage = 1; processAndRenderTables(); }
window.saveWeekStartDay = function() { localStorage.setItem('weekStartDay', document.getElementById('week-start-day').value); processAndRenderTables(); }

async function loadData() {
    enforceDateRules(); 
    
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
        statusEl.innerHTML = '🟡 Connecting...';
        statusEl.style.color = '#eab308';
        statusEl.style.background = 'rgba(234, 179, 8, 0.1)';
    }

    try {
        const res = await fetch(`${API_URL}/transactions`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Server offline or auth failed');

        masterTransactions = await res.json();
        const auditRes = await fetch(`${API_URL}/audit`, { headers: getAuthHeaders() });
        masterAuditLogs = await auditRes.json();
        const catRes = await fetch(`${API_URL}/categories`, { headers: getAuthHeaders() });
        const categories = await catRes.json();
        const setRes = await fetch(`${API_URL}/settings`, { headers: getAuthHeaders() });
        const settings = await setRes.json();

        if (settings) {
            document.getElementById('opening-cash').value = settings.openingCash || 0;
            document.getElementById('opening-bank').value = settings.openingBank || 0;
            if(settings.editorUsername) document.getElementById('set-editor-username').value = settings.editorUsername;
            if(settings.editorPassword) document.getElementById('set-editor-pass').value = settings.editorPassword;
            
            // Check for persistent deletion timer
            if (settings.deletionTimerStart) {
                const elapsedSeconds = Math.floor((Date.now() - new Date(settings.deletionTimerStart).getTime()) / 1000);
                timeLeft = 3600 - elapsedSeconds;
                if (timeLeft > 0) {
                    startTimerUI();
                } else {
                    executeDeepClean();
                }
            }
        }

        calculateBalances(masterTransactions, settings);
        renderCategories(categories);
        renderDashboard();
        
        if(!document.getElementById('dashboard-section').classList.contains('active')) {
            processAndRenderTables();
        }

        if (statusEl) {
            statusEl.innerHTML = '🟢 Connected';
            statusEl.style.color = '#10b981';
            statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
        }

    } catch (error) {
        console.error("Error connecting to Vault:", error);
        if (statusEl) {
            statusEl.innerHTML = '🔴 Offline / Error';
            statusEl.style.color = '#ef4444';
            statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
        }
    }
}

function renderDashboard() {
    const catCanvas = document.getElementById('categoryChart');
    const flowCanvas = document.getElementById('cashflowChart');
    
    if (!catCanvas || !flowCanvas) return; 

    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f8fafc' : '#1e293b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    Chart.defaults.color = textColor;

    const today = new Date();
    const currentMonthStr = today.toISOString().substring(0, 7);

    let monthExpenses = 0;
    let catTotals = {};
    masterTransactions.forEach(t => {
        if (t.type === 'Expense' && t.date.startsWith(currentMonthStr)) {
            monthExpenses += Number(t.amount);
            catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
        }
    });
    
    const expenseEl = document.getElementById('dash-month-expense');
    if (expenseEl) expenseEl.innerText = monthExpenses.toLocaleString('en-IN');

    if (categoryChartInst) categoryChartInst.destroy();
    categoryChartInst = new Chart(catCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(catTotals),
            datasets: [{
                data: Object.values(catTotals),
                backgroundColor: ['#ff0844', '#ffb199', '#4facfe', '#00f2fe', '#f6d365', '#fda085', '#a1c4fd', '#c2e9fb', '#667eea', '#764ba2'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, resizeDelay: 200, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Poppins', size: 10 } } } } }
    });

    let flowData = {};
    for (let i = 5; i >= 0; i--) {
        let d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        let label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        let key = d.toISOString().substring(0, 7);
        flowData[key] = { label: label, in: 0, out: 0 };
    }

    masterTransactions.forEach(t => {
        let monthKey = t.date.substring(0, 7);
        if (flowData[monthKey]) {
            let amt = Number(t.amount);
            if (t.type === 'Receipt') flowData[monthKey].in += amt;
            if (t.type === 'Expense') flowData[monthKey].out += amt;
        }
    });

    const labels = Object.values(flowData).map(x => x.label);
    const dataIn = Object.values(flowData).map(x => x.in);
    const dataOut = Object.values(flowData).map(x => x.out);

    if (cashflowChartInst) cashflowChartInst.destroy();
    cashflowChartInst = new Chart(flowCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Money In', data: dataIn, backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Money Out', data: dataOut, backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, resizeDelay: 200,
            scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { font: { size: 10 } } } },
            plugins: { legend: { labels: { font: { family: 'Poppins', size: 10 } } } } 
        }
    });
}

window.prevPage = function() { if (currentPage > 1) { currentPage--; processAndRenderTables(); } }
window.nextPage = function() { currentPage++; processAndRenderTables(); }

function processAndRenderTables() {
    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;

    const currentView = currentViews[activeTab] || 'All';
    const currentSort = currentSorts[activeTab] || 'date-desc';
    const subFilter = currentSubFilters[activeTab] || '';

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const startDay = parseInt(localStorage.getItem('weekStartDay') || '1');

    let filteredTx = masterTransactions.filter(t => {
        if (activeTab === 'expense-section' && t.type !== 'Expense') return false;
        if (activeTab === 'cash-section' && !(t.account === 'Cash' || t.type === 'Contra')) return false;
        if (activeTab === 'bank-section' && !(t.account === 'Bank Account' || t.type === 'Contra')) return false;

        const tDate = new Date(t.date);
        if (currentView === 'This Month' || currentView === 'Category Month') {
            if (tDate.getMonth() !== currentMonth || tDate.getFullYear() !== currentYear) return false;
        }
        if (currentView === 'This Week') {
            const current = new Date();
            const dayOfWeek = current.getDay();
            const offset = (dayOfWeek < startDay) ? (dayOfWeek - startDay + 7) : (dayOfWeek - startDay);
            const weekStart = new Date(current);
            weekStart.setDate(current.getDate() - offset);
            weekStart.setHours(0,0,0,0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23,59,59,999);
            if (tDate < weekStart || tDate > weekEnd) return false;
        }
        if (currentView === 'All Month' && subFilter !== '') {
            if (!t.date.startsWith(subFilter)) return false;
        }
        if ((currentView === 'Category' || currentView === 'Category Month') && subFilter !== '') {
            if (t.category !== subFilter) return false;
        }
        return true;
    });

    filteredTx.sort((a, b) => {
        if (currentSort === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (currentSort === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (currentSort === 'amount-desc') return b.amount - a.amount;
        if (currentSort === 'amount-asc') return a.amount - b.amount;
        if (currentSort === 'particulars-asc') return a.particulars.localeCompare(b.particulars);
        if (currentSort === 'particulars-desc') return b.particulars.localeCompare(a.particulars);
    });

    currentFilteredData = filteredTx;

    let pagedTx = filteredTx;
    const paginatedTabs = ['expense-section', 'cash-section', 'bank-section'];
    if (!paginatedTabs.includes(activeTab) || noPaginationViews.includes(currentView) || (currentView === 'All Month' && subFilter !== '') || (currentView === 'Category' && subFilter !== '')) {
        document.getElementById('pagination-controls').style.display = 'none';
    } else {
        document.getElementById('pagination-controls').style.display = 'flex';
        const maxPages = Math.ceil(filteredTx.length / rowsPerPage) || 1;
        if (currentPage > maxPages) currentPage = maxPages;
        document.getElementById('page-info').innerText = `Page ${currentPage} of ${maxPages}`;
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        pagedTx = filteredTx.slice(startIndex, endIndex);
    }

    renderTables(pagedTx, masterAuditLogs, activeTab);
}

window.exportTabToPDF = function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape'); 

    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;

    if (['dashboard-section', 'entry-section', 'settings-section'].includes(activeTab)) {
        return alert("Please navigate to a Ledger, Statement, or Search tab to export data.");
    }

    let tabTitle = "Ledger Export";
    if(activeTab === 'expense-section') tabTitle = "Expense Ledger";
    if(activeTab === 'cash-section') tabTitle = "Cash Statement";
    if(activeTab === 'bank-section') tabTitle = "Bank Statement";
    if(activeTab === 'audit-section') tabTitle = "Audit Trail Security Log";
    if(activeTab === 'search-section') tabTitle = "Custom Search Results";
    
    let view = currentViews[activeTab] || 'All Data';
    let sub = currentSubFilters[activeTab] || '';
    let periodText = view;
    
    if(view === 'This Month' || view === 'Category Month') {
        periodText = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    if(sub) periodText += ` | ${sub}`;
    if(activeTab === 'search-section' || activeTab === 'audit-section') periodText = 'Custom Query';

    doc.setFontSize(20);
    doc.text(`Thunder Finance - ${tabTitle}`, 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Context Scope: ${periodText}`, 14, 28);
    doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 34);

    let head = [];
    let body = [];
    let foot = [];
    
    if (activeTab === 'expense-section') {
        head = [['Date', 'Particulars', 'Category', 'Account', 'Amount', 'Note']];
        let totalExp = 0;
        body = currentFilteredData.map(t => {
            totalExp += Number(t.amount);
            return [t.date, t.particulars, t.category || '-', t.account, `Rs. ${t.amount.toLocaleString('en-IN')}`, t.notes || '-'];
        });
        foot = [['', '', '', 'TOTAL EXPENSES:', `Rs. ${totalExp.toLocaleString('en-IN')}`, '']];
    } 
    else if (activeTab === 'cash-section' || activeTab === 'bank-section') {
        head = [['Date', 'Particulars', 'Type', 'Amount', 'Note']];
        let totalIn = 0;
        let totalOut = 0;
        body = currentFilteredData.map(t => {
            let isInc = (t.type === 'Receipt' && t.account === (activeTab === 'cash-section' ? 'Cash' : 'Bank Account')) || (t.type === 'Contra' && t.account === (activeTab === 'cash-section' ? 'Bank Account' : 'Cash'));
            if (isInc) totalIn += Number(t.amount); else totalOut += Number(t.amount);
            let typeStr = isInc ? 'IN' : 'OUT';
            return [t.date, t.particulars, t.type, `Rs. ${t.amount.toLocaleString('en-IN')} (${typeStr})`, t.notes || '-'];
        });
        let net = totalIn - totalOut;
        foot = [['', '', 'NET TOTAL:', `IN: Rs.${totalIn.toLocaleString('en-IN')} | OUT: Rs.${totalOut.toLocaleString('en-IN')} | NET: Rs.${net.toLocaleString('en-IN')}`, '']];
    } 
    else if (activeTab === 'search-section') {
        head = [['Date', 'Particulars', 'Type', 'Account', 'Amount']];
        let totalAmt = 0;
        body = currentFilteredData.map(t => {
            totalAmt += Number(t.amount);
            return [t.date, t.particulars, t.type, t.account, `Rs. ${t.amount.toLocaleString('en-IN')}`]
        });
        foot = [['', '', '', 'TOTAL SEARCH AMOUNT:', `Rs. ${totalAmt.toLocaleString('en-IN')}`]];
    }
    else if (activeTab === 'audit-section') {
        // Reduced to 3 columns to give the diff text more room to breathe
        head = [['Log Time', 'Action', 'Changed Fields']];
        body = masterAuditLogs.map(log => {
            
            const isRestored = log.action.includes('RESTORED');
            const baseAction = log.action.replace(' (RESTORED)', '');

            let timeStr = log.dateChanged;
            if (!timeStr.includes('Z') && !timeStr.includes('T')) timeStr += " UTC";
            let localTime = new Date(timeStr).toLocaleString();
            if (localTime === 'Invalid Date') localTime = log.dateChanged;
            
            const old = log.originalData || {};
            const newD = log.newData || {};
            let changeStr = '-';
            
            // SMART DIFF LOGIC FOR PDF
            if (baseAction === 'MODIFIED' && log.newData) {
                let changes = [];
                if (old.date !== newD.date) changes.push(`Date: ${old.date} -> ${newD.date}`);
                if (old.type !== newD.type) changes.push(`Type: ${old.type} -> ${newD.type}`);
                if (old.particulars !== newD.particulars) changes.push(`Particulars: ${old.particulars} -> ${newD.particulars}`);
                if (Number(old.amount) !== Number(newD.amount)) changes.push(`Amt: Rs.${Number(old.amount).toLocaleString('en-IN')} -> Rs.${Number(newD.amount).toLocaleString('en-IN')}`);
                if ((old.category || '-') !== (newD.category || '-')) changes.push(`Cat: ${old.category || '-'} -> ${newD.category || '-'}`);
                if (old.account !== newD.account) changes.push(`Acc: ${old.account} -> ${newD.account}`);
                if ((old.notes || '-') !== (newD.notes || '-')) changes.push(`Note: ${old.notes || '-'} -> ${newD.notes || '-'}`);
                
                changeStr = changes.length > 0 ? changes.join(' | ') : 'No specific fields changed.';
            } else if (baseAction === 'DELETED') {
                changeStr = `DELETED: ${old.date} | ${old.particulars} | Rs.${Number(old.amount).toLocaleString('en-IN')}`;
            }
            
            return [localTime, log.action, changeStr];
        });
    }

    doc.autoTable({
        startY: 42,
        head: head,
        body: body,
        foot: foot,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 10 },
        headStyles: { fillColor: [102, 126, 234] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
    });

    doc.save(`Thunder_${tabTitle.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
}

window.generateMasterPDF = function() {
    const start = document.getElementById('master-export-start').value;
    const end = document.getElementById('master-export-end').value;

    if (!start || !end) return alert("Please select both a Start Date and End Date for the Master Export.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    let exportData = masterTransactions.filter(t => t.date >= start && t.date <= end);
    exportData.sort((a,b) => new Date(a.date) - new Date(b.date));

    doc.setFontSize(22);
    doc.text(`Thunder Finance - MASTER DATABASE EXPORT`, 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Global Timeframe: ${start} to ${end}`, 14, 28);
    doc.text(`Total Records Found: ${exportData.length}`, 14, 34);
    doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 40);

    let totalAmt = 0;
    const head = [['Date', 'Ledger', 'Particulars', 'Type', 'Category', 'Amount']];
    const body = exportData.map(t => {
        totalAmt += Number(t.amount);
        return [
            t.date, 
            t.account, 
            t.particulars, 
            t.type, 
            t.category || '-', 
            `Rs. ${t.amount.toLocaleString('en-IN')}`
        ];
    });
    
    const foot = [['', '', '', '', 'GRAND TOTAL:', `Rs. ${totalAmt.toLocaleString('en-IN')}`]];

    doc.autoTable({
        startY: 48,
        head: head,
        body: body,
        foot: foot,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
    });

    doc.save(`Thunder_Master_Export_${start}_to_${end}.pdf`);
}

window.cloneEntry = function(id) {
    const t = masterTransactions.find(x => x._id === id);
    if(!t) return;
    
    document.querySelector('[onclick*="entry-section"]').click();
    
    document.getElementById('type').value = t.type;
    document.getElementById('particulars').value = t.particulars;
    document.getElementById('amount').value = t.amount;
    document.getElementById('account').value = t.account;
    document.getElementById('notes').value = t.notes || '';
    
    document.getElementById('type').dispatchEvent(new Event('change'));
    if(t.type === 'Expense') {
        document.getElementById('category').value = t.category || '';
    }
}

function renderTables(transactions, auditLogs, activeTab) {
    document.getElementById('expense-table-body').innerHTML = '';
    document.getElementById('cash-table-body').innerHTML = '';
    document.getElementById('bank-table-body').innerHTML = '';
    document.getElementById('audit-table-body').innerHTML = '';
    
    let expenseTotal = 0;
    let cashIn = 0, cashOut = 0;
    let bankIn = 0, bankOut = 0;

    transactions.forEach(t => {
        const amt = Number(t.amount);
        const editBtn = `<button class="edit-btn" onclick="openEditModal('${t._id}', '${t.date}', '${t.type}', '${encodeURIComponent(t.particulars)}', '${t.amount}', '${t.category || ''}', '${t.account}', '${encodeURIComponent(t.notes || '')}', '${t.recordedBy || 'System'}')">Edit</button>`;
        const cloneBtn = `<button class="secondary-btn" style="padding: 2px 6px; font-size: 10px; margin-right: 4px;" onclick="cloneEntry('${t._id}')" title="Clone Record">📋</button>`;
        const delBtn = isAdminUnlocked ? `<button class="del-btn" onclick="deleteEntry('${t._id}')">Delete</button>` : `<button class="del-btn" disabled style="opacity: 0.3; cursor:not-allowed;">Locked</button>`;
        const actionCell = `${cloneBtn} ${editBtn} ${delBtn}`;

        let displayNote = t.notes || '-';

        if (activeTab === 'expense-section' && t.type === 'Expense') {
            expenseTotal += amt;
            document.getElementById('expense-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Category">${t.category || '-'}</td><td data-label="Account">${t.account}</td><td data-label="Amount">₹${t.amount}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
        
        if (activeTab === 'cash-section' && (t.account === 'Cash' || t.type === 'Contra')) {
            let isCashIncrease = false;
            if (t.type === 'Receipt' && t.account === 'Cash') isCashIncrease = true;
            if (t.type === 'Contra' && t.account === 'Bank Account') isCashIncrease = true; 
            if (isCashIncrease) cashIn += amt; else cashOut += amt;

            const inOutBadge = isCashIncrease 
                ? `<span style="background-color: rgba(16, 185, 129, 0.2); color: #059669; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">IN</span>`
                : `<span style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">OUT</span>`;

            document.getElementById('cash-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Amount">₹${t.amount} ${inOutBadge}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
        
        if (activeTab === 'bank-section' && (t.account === 'Bank Account' || t.type === 'Contra')) {
            let isBankIncrease = false;
            if (t.type === 'Receipt' && t.account === 'Bank Account') isBankIncrease = true;
            if (t.type === 'Contra' && t.account === 'Cash') isBankIncrease = true; 
            if (isBankIncrease) bankIn += amt; else bankOut += amt;

            const drCrBadge = isBankIncrease 
                ? `<span style="background-color: rgba(16, 185, 129, 0.2); color: #059669; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">CR.</span>`
                : `<span style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">DR.</span>`;

            document.getElementById('bank-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Amount">₹${t.amount} ${drCrBadge}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
    });

    if(activeTab === 'expense-section') {
        const foot = document.getElementById('expense-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="4" style="text-align: right;">Total View Expenses:</td><td colspan="3" style="color: #ef4444;">₹${expenseTotal.toLocaleString('en-IN')}</td></tr>`;
    }
    if(activeTab === 'cash-section') {
        const netCash = cashIn - cashOut;
        const netColor = netCash >= 0 ? '#10b981' : '#ef4444';
        const foot = document.getElementById('cash-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="3" style="text-align: right;">View Totals:</td><td colspan="3"><span style="color: #10b981;">IN: ₹${cashIn.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: #ef4444;">OUT: ₹${cashOut.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: ${netColor}; font-weight: 800;">NET: ₹${netCash.toLocaleString('en-IN')}</span></td></tr>`;
    }
    if(activeTab === 'bank-section') {
        const netBank = bankIn - bankOut;
        const netColor = netBank >= 0 ? '#10b981' : '#ef4444';
        const foot = document.getElementById('bank-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="3" style="text-align: right;">View Totals:</td><td colspan="3"><span style="color: #10b981;">IN: ₹${bankIn.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: #ef4444;">OUT: ₹${bankOut.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: ${netColor}; font-weight: 800;">NET: ₹${netBank.toLocaleString('en-IN')}</span></td></tr>`;
    }

    if (activeTab === 'audit-section') {
        auditLogs.forEach(log => {
            const old = log.originalData || {};
            const newD = log.newData || {}; 
            
            const isRestored = log.action.includes('RESTORED');
            const baseAction = log.action.replace(' (RESTORED)', '');

            let statusBadge = `<strong>${baseAction}</strong>`;
            let restoreBtn = `<button class="edit-btn" onclick="restoreEntry('${log._id}')">Restore</button>`;
            
            if (isRestored) {
                statusBadge = `<strong>${baseAction}</strong><br><span style="color: #6366f1; font-size: 11px; font-weight: 800;">RESTORED</span>`;
                restoreBtn = `<button class="secondary-btn" disabled style="opacity: 0.5; cursor: not-allowed;">Restored</button>`;
            }

            let timeStr = log.dateChanged;
            if (!timeStr.includes('Z') && !timeStr.includes('T')) timeStr += " UTC";
            let localTime = new Date(timeStr).toLocaleString();
            if (localTime === 'Invalid Date') localTime = log.dateChanged; 
            
            let details = '';
            
            // UPGRADED SMART DIFF LOGIC (Badge UI)
            if (baseAction === 'MODIFIED' && log.newData) {
                let changes = [];
                
                // Beautiful Flexbox Badge Layout
                const diff = (label, o, n) => `
                    <div style="display: flex; align-items: center; margin-bottom: 6px; font-size: 13px; gap: 8px; flex-wrap: wrap;">
                        <span style="color: var(--text-sub); min-width: 80px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">${label}</span>
                        <span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 2px 6px; border-radius: 4px; text-decoration: line-through;">${o}</span>
                        <span style="color: #64748b; font-size: 12px;">➔</span>
                        <span style="background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${n}</span>
                    </div>`;
                
                if (old.date !== newD.date) changes.push(diff('Date', old.date, newD.date));
                if (old.type !== newD.type) changes.push(diff('Type', old.type, newD.type));
                if (old.particulars !== newD.particulars) changes.push(diff('Particulars', old.particulars, newD.particulars));
                if (Number(old.amount) !== Number(newD.amount)) changes.push(diff('Amount', `₹${Number(old.amount).toLocaleString('en-IN')}`, `₹${Number(newD.amount).toLocaleString('en-IN')}`));
                if ((old.category || '-') !== (newD.category || '-')) changes.push(diff('Category', old.category || '-', newD.category || '-'));
                if (old.account !== newD.account) changes.push(diff('Account', old.account, newD.account));
                if ((old.notes || '-') !== (newD.notes || '-')) changes.push(diff('Note', old.notes || '-', newD.notes || '-'));

                // Wrap all changes in a subtle left-bordered container
                details = changes.length > 0 
                    ? `<div style="border-left: 2px solid var(--border-color); padding-left: 10px; margin-top: 4px;">${changes.join('')}</div>` 
                    : `<span style="color: #64748b; font-style: italic;">No specific fields changed.</span>`;
                    
            } else if (baseAction === 'DELETED') {
                details = `
                    <div style="background: rgba(239, 68, 68, 0.05); padding: 8px; border-radius: 6px; border: 1px dashed rgba(239, 68, 68, 0.3);">
                        <strong>Old Record:</strong> ${old.date} | ${old.particulars} (₹${Number(old.amount).toLocaleString('en-IN')})<br>
                        <strong style="color: #ef4444; font-size: 12px; margin-top: 4px; display: inline-block;">STATUS: DELETED</strong>
                    </div>`;
            }
            
            document.getElementById('audit-table-body').innerHTML += `<tr><td data-label="Log Time">${localTime}</td><td data-label="Status">${statusBadge}</td><td data-label="Record Details">${details}</td><td data-label="Action">${restoreBtn}</td></tr>`;
        });
    }
}

window.runUniversalSearch = function() {
    const query = document.getElementById('uni-search').value.toLowerCase().trim();
    const type = document.getElementById('uni-type').value;
    const start = document.getElementById('uni-start').value;
    const end = document.getElementById('uni-end').value;
    const sort = document.getElementById('uni-sort').value;

    let results = masterTransactions.filter(t => {
        let matchesQuery = query === '' || 
            (t.particulars && t.particulars.toLowerCase().includes(query)) ||
            (t.notes && t.notes.toLowerCase().includes(query)) ||
            (t.category && t.category.toLowerCase().includes(query)) ||
            (t.account && t.account.toLowerCase().includes(query)) ||
            (t.amount && t.amount.toString().includes(query));

        let matchesType = type === '' || t.type === type;
        let matchesStart = start ? t.date >= start : true;
        let matchesEnd = end ? t.date <= end : true;
        return matchesQuery && matchesType && matchesStart && matchesEnd;
    });

    results.sort((a, b) => {
        if (sort === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (sort === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (sort === 'amount-desc') return b.amount - a.amount;
        if (sort === 'amount-asc') return a.amount - b.amount;
    });

    currentFilteredData = results;

    const tbody = document.getElementById('search-table-body');
    tbody.innerHTML = '';

    if(results.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px;">No matching records found.</td></tr>`;
        return;
    }

    results.forEach(t => {
        const editBtn = `<button class="edit-btn" onclick="openEditModal('${t._id}', '${t.date}', '${t.type}', '${encodeURIComponent(t.particulars)}', '${t.amount}', '${t.category || ''}', '${t.account}', '${encodeURIComponent(t.notes || '')}', '${t.recordedBy || 'System'}')">Edit</button>`;
        const delBtn = isAdminUnlocked ? `<button class="del-btn" onclick="deleteEntry('${t._id}')">Delete</button>` : `<button class="del-btn" disabled style="opacity: 0.3; cursor:not-allowed;">Locked</button>`;
        const actionCell = `${editBtn} ${delBtn}`;
        let amtColor = t.type === 'Receipt' ? '#10b981' : (t.type === 'Expense' ? '#ef4444' : 'inherit');
        tbody.innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Account">${t.account}</td><td data-label="Amount" style="color: ${amtColor}; font-weight: bold;">₹${t.amount}</td><td data-label="Action">${actionCell}</td></tr>`;
    });
}

window.clearUniversalSearch = function() {
    document.getElementById('uni-search').value = '';
    document.getElementById('uni-type').value = '';
    document.getElementById('uni-start').value = '';
    document.getElementById('uni-end').value = '';
    document.getElementById('uni-sort').value = 'date-desc';
    runUniversalSearch();
}

function calculateBalances(transactions, settings) {
    let currentCash = settings ? Number(settings.openingCash) || 0 : 0;
    let currentBank = settings ? Number(settings.openingBank) || 0 : 0;
    transactions.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'Receipt') { if (t.account === 'Cash') currentCash += amt; if (t.account === 'Bank Account') currentBank += amt; } 
        else if (t.type === 'Expense') { if (t.account === 'Cash') currentCash -= amt; if (t.account === 'Bank Account') currentBank -= amt; } 
        else if (t.type === 'Contra') { if (t.account === 'Cash') { currentCash -= amt; currentBank += amt; } else if (t.account === 'Bank Account') { currentBank -= amt; currentCash += amt; } }
    });
    document.getElementById('live-cash').innerText = currentCash.toLocaleString('en-IN');
    document.getElementById('live-bank').innerText = currentBank.toLocaleString('en-IN');
}

function renderCategories(categories) {
    const categoryDropdown = document.getElementById('category');
    const categoryTable = document.getElementById('category-table-body');
    categoryDropdown.innerHTML = '<option value="">Select a Category...</option>';
    categoryTable.innerHTML = '';
    categories.forEach(cat => {
        categoryDropdown.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
        const delBtn = `<button class="del-btn" onclick="deleteCategory('${cat._id}')">Delete</button>`;
        categoryTable.innerHTML += `<tr><td data-label="Category">${cat.name}</td><td data-label="Action">${delBtn}</td></tr>`;
    });
}

document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const localDate = enforceDateRules();
    if (document.getElementById('date').value > localDate) return alert("Future/post-dated transactions are not allowed!");

    let recordedByName = 'System';
    if (auth.currentUser && auth.currentUser.displayName) {
        recordedByName = auth.currentUser.displayName.split(' | ')[0];
    }

    const newEntry = {
        date: document.getElementById('date').value,
        type: document.getElementById('type').value,
        particulars: document.getElementById('particulars').value,
        amount: Number(document.getElementById('amount').value),
        category: document.getElementById('category').value,
        account: document.getElementById('account').value,
        notes: document.getElementById('notes').value,
        recordedBy: recordedByName
    };
    await fetch(`${API_URL}/transactions`, { method: 'POST', headers: getAuthHeaders(true), body: JSON.stringify(newEntry) });
    document.getElementById('entry-form').reset();
    
    const catSelect = document.getElementById('category');
    catSelect.disabled = false;
    catSelect.required = true;
    enforceDateRules(); 
    loadData();
});

window.openEditModal = function(id, date, type, particulars, amount, category, account, notes, recordedBy) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-date').value = date;
    document.getElementById('edit-type').value = type;
    document.getElementById('edit-particulars').value = decodeURIComponent(particulars);
    document.getElementById('edit-amount').value = amount;
    document.getElementById('edit-account').value = account;
    const decodedNotes = decodeURIComponent(notes);
    document.getElementById('edit-notes').value = decodedNotes === '-' ? '' : decodedNotes;
    
    const catDropdown = document.getElementById('edit-category');
    catDropdown.innerHTML = document.getElementById('category').innerHTML;
    if (type === 'Receipt' || type === 'Contra') { catDropdown.disabled = true; catDropdown.value = ''; } else { catDropdown.disabled = false; catDropdown.value = category; }
    
    enforceDateRules(); 
    document.getElementById('edit-modal').style.display = 'flex';
}

window.closeEditModal = function() {
    document.getElementById('edit-modal').style.display = 'none';
    document.getElementById('edit-form').reset();
    document.getElementById('auth-editor-username').value = '';
    document.getElementById('auth-editor-pass').value = '';
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const localDate = enforceDateRules();
    if (document.getElementById('edit-date').value > localDate) return alert("Future/post-dated transactions are not allowed!");

    let recordedByName = 'System';
    if (auth.currentUser && auth.currentUser.displayName) {
        recordedByName = auth.currentUser.displayName.split(' | ')[0];
    }

    const id = document.getElementById('edit-id').value;
    const updatedData = {
        date: document.getElementById('edit-date').value,
        type: document.getElementById('edit-type').value,
        particulars: document.getElementById('edit-particulars').value,
        amount: Number(document.getElementById('edit-amount').value),
        category: document.getElementById('edit-category').value,
        account: document.getElementById('edit-account').value,
        notes: document.getElementById('edit-notes').value,
        recordedBy: recordedByName 
    };
    const editorUsername = document.getElementById('auth-editor-username').value.trim();
    const editorPassword = document.getElementById('auth-editor-pass').value.trim();
    const res = await fetch(`${API_URL}/transactions/${id}`, { method: 'PUT', headers: getAuthHeaders(true), body: JSON.stringify({ editorUsername, editorPassword, updatedData }) });
    const data = await res.json();
    if (res.ok) { alert("Transaction updated successfully!"); closeEditModal(); loadData(); } else { alert("Error: " + (data.error || "Authentication failed")); }
});

document.getElementById('editor-creds-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editorUsername = document.getElementById('set-editor-username').value.trim();
    const editorPassword = document.getElementById('set-editor-pass').value.trim();
    await fetch(`${API_URL}/settings`, { method: 'POST', headers: getAuthHeaders(true), body: JSON.stringify({ editorUsername, editorPassword }) });
    alert("Editor Credentials Saved Successfully!");
});

window.deleteEntry = async function(id) {
    if (!isAdminUnlocked) return alert("Security Block: Please log in via the Settings tab to delete records.");
    if (confirm("Move to Audit Trail?")) { await fetch(`${API_URL}/transactions/${id}`, { method: 'DELETE', headers: { 'admin-access': 'true', 'Authorization': `Bearer ${currentUserToken}` } }); loadData(); }
}

window.restoreEntry = async function(logId) {
    if (!confirm("Restore this record back to its exact original state?")) return;

    // 1. Find the exact log the user clicked
    const log = masterAuditLogs.find(l => l._id === logId);
    if (!log) return alert("Error: Log data not found.");

    const old = log.originalData;
    const txId = log.transactionId || old._id; 
    
    // 2. Grab Editor Credentials from the Settings tab
    const editorUsername = document.getElementById('set-editor-username').value;
    const editorPassword = document.getElementById('set-editor-pass').value;

    try {
        const baseAction = log.action.replace(' (RESTORED)', '');

        if (baseAction === 'MODIFIED') {
            const res = await fetch(`${API_URL}/transactions/${txId}`, {
                method: 'PUT',
                headers: getAuthHeaders(true),
                body: JSON.stringify({ 
                    editorUsername: editorUsername, 
                    editorPassword: editorPassword, 
                    updatedData: {
                        date: old.date,
                        type: old.type,
                        particulars: old.particulars,
                        amount: Number(old.amount),
                        category: old.category,
                        account: old.account,
                        notes: old.notes
                    }
                })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error || "Server rejected the modification request.");
        } 
        else if (baseAction === 'DELETED') {
            const res = await fetch(`${API_URL}/transactions`, {
                method: 'POST',
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    date: old.date,
                    type: old.type,
                    particulars: old.particulars,
                    amount: Number(old.amount),
                    category: old.category,
                    account: old.account,
                    notes: old.notes
                })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error || "Server rejected the recreation request.");
        }

        alert("Record successfully restored!");
        
        // 3. Mark the log as RESTORED in the database & update instantly locally
        try {
            await fetch(`${API_URL}/audit-status/${logId}`, { method: 'PUT', headers: getAuthHeaders() });
            log.action = log.action + ' (RESTORED)'; // Force instant UI update
        } catch(e) { 
            console.error(e); 
        }
        
        loadData(); // Refresh all tables

    } catch (error) {
        alert("Restore failed: " + error.message);
    }
};

document.getElementById('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const catName = document.getElementById('new-category-name').value;
    await fetch(`${API_URL}/categories`, { method: 'POST', headers: getAuthHeaders(true), body: JSON.stringify({ name: catName }) });
    document.getElementById('category-form').reset();
    loadData();
});

window.deleteCategory = async function(id) {
    if (confirm("Delete this category?")) { await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadData(); }
}

document.getElementById('balance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const openingCash = Number(document.getElementById('opening-cash').value);
    const openingBank = Number(document.getElementById('opening-bank').value);
    await fetch(`${API_URL}/settings`, { method: 'POST', headers: getAuthHeaders(true), body: JSON.stringify({ openingCash, openingBank, isAdminOverride: isAdminUnlocked }) });
    alert("Opening Balances Updated!"); loadData(); 
});

document.getElementById('type').addEventListener('change', function(e) {
    const catSelect = document.getElementById('category');
    if (e.target.value === 'Receipt' || e.target.value === 'Contra') { catSelect.disabled = true; catSelect.required = false; catSelect.value = ''; } else { catSelect.disabled = false; catSelect.required = true; }
});

if(document.getElementById('edit-type')) {
    document.getElementById('edit-type').addEventListener('change', function(e) {
        const editCatSelect = document.getElementById('edit-category');
        if (e.target.value === 'Receipt' || e.target.value === 'Contra') { editCatSelect.disabled = true; editCatSelect.value = ''; } else { editCatSelect.disabled = false; }
    });
}

// -------------------------------------------------------------
// FIREBASE AUTHENTICATION LOGIC (Multi-User & Email Verification)
// -------------------------------------------------------------

onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (!user.emailVerified) {
            currentUserToken = null;
            document.getElementById('global-login-wall').style.display = 'flex';
            document.querySelector('.app-window').style.display = 'none';
            return;
        }

        currentUserToken = await user.getIdToken();
        document.getElementById('global-login-wall').style.display = 'none';
        document.querySelector('.app-window').style.display = 'flex'; 
        
        if (user.displayName) {
            const userDetails = user.displayName.split(' | ');
            document.getElementById('profile-username').innerText = userDetails[0] || 'N/A';
            document.getElementById('profile-fullname').innerText = userDetails[1] || 'N/A';
            document.getElementById('profile-phone').innerText = userDetails[2] || 'N/A';
        }
        document.getElementById('profile-email').innerText = user.email || 'N/A';
        
        await loadData();
        renderDashboard();
    } else {
        currentUserToken = null;
        document.getElementById('global-login-wall').style.display = 'flex';
        document.querySelector('.app-window').style.display = 'none';
    }
});

const formSignup = document.getElementById('form-signup');
if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullname = document.getElementById('signup-fullname').value;
        const phone = document.getElementById('signup-phone').value;
        const username = document.getElementById('signup-username').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirmPass = document.getElementById('signup-password-confirm').value;
        
        const btn = document.getElementById('btn-signup');
        const errorEl = document.getElementById('error-signup');
        
        if (password !== confirmPass) {
            errorEl.innerText = "Passwords do not match!";
            errorEl.style.display = 'block';
            return;
        }

        btn.innerText = "Creating Account...";
        btn.disabled = true;
        errorEl.style.display = 'none';

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { 
                displayName: `${username} | ${fullname} | ${phone}` 
            });
            await sendEmailVerification(userCredential.user);
            await signOut(auth);
            
            alert("Account created! 📩 Please check your inbox and click the verification link before logging in.");
            document.getElementById('form-signup').reset();
            toggleAuth('login');
        } catch (error) {
            let cleanMessage = "An error occurred. Please try again.";
            if (error.code === 'auth/email-already-in-use') cleanMessage = "This email is already in use.";
            if (error.code === 'auth/weak-password') cleanMessage = "Password should be at least 6 characters.";
            if (error.code === 'auth/invalid-email') cleanMessage = "Invalid email format.";

            errorEl.innerText = cleanMessage;
            errorEl.style.display = 'block';
        } finally {
            btn.innerText = "Create Account";
            btn.disabled = false;
        }
    });
}

const formLogin = document.getElementById('form-login');
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        const btn = document.getElementById('btn-login');
        const errorEl = document.getElementById('error-login');
        
        btn.innerText = "Authenticating...";
        btn.disabled = true;
        errorEl.style.display = 'none';

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            if (!userCredential.user.emailVerified) {
                await signOut(auth);
                alert("🚨 Access Denied. You must verify your email address before logging in.");
                btn.innerText = "Access Vault";
                btn.disabled = false;
                return;
            }
            btn.innerText = "Access Vault";
            btn.disabled = false;
        } catch (error) {
            let cleanMessage = "Incorrect email or password.";
            if (error.code === 'auth/too-many-requests') cleanMessage = "Too many failed attempts. Try again later.";
            if (error.code === 'auth/invalid-email') cleanMessage = "Invalid email format.";

            errorEl.innerText = cleanMessage;
            errorEl.style.display = 'block';
            btn.innerText = "Access Vault";
            btn.disabled = false;
        }
    });
}

window.globalLogout = function() {
    signOut(auth).then(() => {
        window.location.reload();
    });
};

const settingsAuthForm = document.getElementById('settings-auth-form');
if (settingsAuthForm) {
    settingsAuthForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('settings-email').value;
        const pass = document.getElementById('settings-password').value;
        const errorEl = document.getElementById('settings-auth-error');
        const btn = settingsAuthForm.querySelector('button');
        
        btn.innerText = "Verifying...";
        
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            isAdminUnlocked = true;
            document.getElementById('admin-login-box').style.display = 'none';
            document.getElementById('admin-zone').style.display = 'block';
            document.getElementById('audit-tab-btn').style.display = 'inline-block';
            errorEl.style.display = 'none';
            settingsAuthForm.reset();
        } catch (error) {
            errorEl.innerText = "Access Denied: Incorrect Email or Password.";
            errorEl.style.display = 'block';
        } finally {
            btn.innerText = "Unlock Settings";
        }
    });
}

window.logoutAdmin = function() {
    isAdminUnlocked = false;
    document.getElementById('admin-zone').style.display = 'none';
    document.getElementById('audit-tab-btn').style.display = 'none';
    document.getElementById('admin-login-box').style.display = 'block';
    
    const settingsTabBtn = document.querySelector('button[onclick*="settings-section"]');
    if(settingsTabBtn) openTab({ currentTarget: settingsTabBtn }, 'settings-section');
};

// ==========================================
// CRITICAL OPERATIONS
// ==========================================

function startTimerUI() {
    document.getElementById('initiate-clean-btn').style.display = 'none';
    document.getElementById('deep-clean-confirm-input').disabled = true;
    document.getElementById('timer-container').style.display = 'block';
    
    updateTimerUI();
    
    deepCleanTimer = setInterval(() => {
        timeLeft--;
        updateTimerUI();
        if (timeLeft <= 0) {
            clearInterval(deepCleanTimer);
            executeDeepClean();
        }
    }, 1000);
}

function updateTimerUI() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('countdown-display').innerText = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function executeDeepClean() {
    try {
        const res = await fetch(`${API_URL}/deep-clean`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ userId: auth.currentUser.uid })
        });
        if(res.ok) {
            alert('Your data has been completely and permanently deleted.');
            auth.signOut().then(() => location.reload());
        }
    } catch (err) {
        console.error('Clean failed:', err);
    }
}

document.getElementById('factory-reset-btn').addEventListener('click', async () => {
    const confirmText = document.getElementById('reset-confirm-input').value;
    if (confirmText !== 'CLEAR-BALANCES') {
        return alert('Please type CLEAR-BALANCES exactly as shown to confirm.');
    }
    
    try {
        const res = await fetch(`${API_URL}/reset-balances`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ userId: auth.currentUser.uid })
        });
        if(res.ok) {
            alert('Your opening balances have been successfully reset.');
            document.getElementById('reset-confirm-input').value = '';
            location.reload(); 
        }
    } catch (err) {
        console.error('Reset failed:', err);
    }
});

document.getElementById('initiate-clean-btn').addEventListener('click', async () => {
    const confirmText = document.getElementById('deep-clean-confirm-input').value;
    if (confirmText !== 'DELETE-MY-DATA') {
        return alert('Please type DELETE-MY-DATA exactly as shown to confirm.');
    }
    
    await fetch(`${API_URL}/schedule-clean`, { method: 'POST', headers: getAuthHeaders() });
    
    timeLeft = 3600;
    startTimerUI();
});

document.getElementById('cancel-clean-btn').addEventListener('click', async () => {
    clearInterval(deepCleanTimer);
    
    await fetch(`${API_URL}/cancel-clean`, { method: 'POST', headers: getAuthHeaders() });
    
    document.getElementById('initiate-clean-btn').style.display = 'inline-block';
    document.getElementById('deep-clean-confirm-input').disabled = false;
    document.getElementById('deep-clean-confirm-input').value = '';
    document.getElementById('timer-container').style.display = 'none';
    alert('Deep clean safely cancelled.');
});

// ==========================================
// NEW PROFILE & SECURITY LOGIC
// ==========================================

// 1. Update Profile Details (Name & Phone Optional)
document.getElementById('update-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    
    const newNameInput = document.getElementById('update-fullname').value.trim();
    const newPhoneInput = document.getElementById('update-phone').value.trim();
    
    if (!newNameInput && !newPhoneInput) {
        return alert("Please enter a new name or phone number to update.");
    }

    btn.innerText = "Saving...";

    let currentUsername = 'User';
    let currentName = 'N/A';
    let currentPhone = 'N/A';
    
    if (auth.currentUser && auth.currentUser.displayName) {
        const parts = auth.currentUser.displayName.split(' | ');
        currentUsername = parts[0] || 'User';
        currentName = parts[1] || 'N/A';
        currentPhone = parts[2] || 'N/A';
    }
    
    const finalName = newNameInput ? newNameInput : currentName;
    const finalPhone = newPhoneInput ? newPhoneInput : currentPhone;
    
    try {
        await updateProfile(auth.currentUser, { displayName: `${currentUsername} | ${finalName} | ${finalPhone}` });
        alert("Profile details updated successfully!");
        location.reload();
    } catch (error) {
        alert("Failed to update profile: " + error.message);
        btn.innerText = "Save Details";
    }
});

document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPass = document.getElementById('old-password').value;
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-new-password').value;
    const btn = e.target.querySelector('button');

    if (newPass !== confirmPass) return alert("New passwords do not match!");
    
    btn.innerText = "Verifying...";
    try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, oldPass);
        await reauthenticateWithCredential(auth.currentUser, credential);
        
        await updatePassword(auth.currentUser, newPass);
        alert("Password updated securely!");
        e.target.reset();
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.innerText = "Update Password";
    }
});