import { DASHBOARD_PAGE_RENDER_SCRIPT } from "./web-dashboard-page-render-script.js";
import { DASHBOARD_AI_CLIENT_SCRIPT } from "./web-dashboard-ai-client-script.js";
import { buildDashboardBrowserEnrollmentCommand } from "./dashboard-enrollment-commands.js";
import { DASHBOARD_STYLES } from "./web-dashboard-styles.js";
import { BRAND_STYLES } from "./web-dashboard-brand-styles.js";
import { DASHBOARD_BRAND_FINGERPRINT } from "./web-dashboard-brand.js";
import { EXPERIENCE_STYLES } from "./web-dashboard-experience-styles.js";
import { AI_CLIENT_STYLES } from "./web-dashboard-ai-client-styles.js";
import { DASHBOARD_ENROLLMENT_FEEDBACK_SCRIPT } from "./dashboard-enrollment-feedback-script.js";
export function renderDashboardHtml(
  initialUserBase64: string,
  mcpUrlJson: string,
  publicUrlJson: string,
  authProvidersJson = '{"google":true,"github":true}',
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ssh-mcp-pro · Connect your devices to AI</title>
  <meta name="theme-color" content="#10111F">
  <meta name="description" content="Connect your own devices to ChatGPT, Claude and Gemini with controlled SSH MCP access.">
  <link rel="icon" type="image/x-icon" href="/favicon.ico?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <link rel="icon" type="image/png" sizes="192x192" href="/brand/icon-192.png?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <link rel="manifest" href="/site.webmanifest?v=${DASHBOARD_BRAND_FINGERPRINT}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${DASHBOARD_STYLES}
${BRAND_STYLES}
${EXPERIENCE_STYLES}
${AI_CLIENT_STYLES}</style>
</head>
<body>
  <header class="public-header">
    <a class="logo-area" href="/" aria-label="ssh-mcp-pro home">
      <img class="brand-mark" src="/brand/ssh-mcp-pro-icon.png?v=${DASHBOARD_BRAND_FINGERPRINT}" width="46" height="46" alt="ssh-mcp-pro">
      <span><span class="brand-title">ssh-mcp-pro</span><span class="brand-sub">Your computers, connected to AI</span></span>
    </a>
    <div class="user-area" id="headerUserArea"></div>
  </header>

  <div class="container" id="appRoot">
    <!-- Rendered by client script based on currentUser -->
  </div>

  <script>
    const INITIAL_USER = JSON.parse(atob("${initialUserBase64}"));
    const MCP_URL = ${mcpUrlJson};
    const AUTH_PROVIDERS = ${authProvidersJson};
    const PUBLIC_URL = ${publicUrlJson};
    const BROWSER_LINUX_COMMAND = ${JSON.stringify(buildDashboardBrowserEnrollmentCommand(JSON.parse(publicUrlJson) as string))};

    let currentUser = INITIAL_USER;
    let activeTab = 'devices';
    let devicesList = [];
    let devicesLoaded = false;
    let devicesError = '';
    let selectedInstallOs = 'windows';
    let auditList = [];
    let auditLoaded = false;
    let auditError = '';
    let usageData = currentUser && currentUser.userUsage ? { userUsage: currentUser.userUsage } : null;
    let aiClientsList = [];
    let aiConnectionsList = [];
    let strictVisibilityEnabled = false;
    let aiClientsLoaded = false;
    let aiClientsError = '';
    let aiClientNotice = '';

    ${DASHBOARD_ENROLLMENT_FEEDBACK_SCRIPT}

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }

    function renderHeader() {
      const container = document.getElementById('headerUserArea');
      if (currentUser) {
        container.innerHTML = '<a class="btn btn-outline btn-sm" href="/dashboard">Open workspace</a>';
      } else if (AUTH_PROVIDERS.google || AUTH_PROVIDERS.github) {
        container.innerHTML = '<a href="' + (AUTH_PROVIDERS.google ? '/auth/login/google' : '/auth/login/github') +
          '" class="btn btn-primary btn-sm">Open workspace</a>';
      } else {
        container.innerHTML = '<span class="badge badge-gray">Local setup</span>';
      }
    }

    function renderApp() {
      const root = document.getElementById('appRoot');
      document.body?.classList?.toggle('workspace-active', !!currentUser);
      if (!currentUser) {
        root.innerHTML = renderLanding();
        if (!AUTH_PROVIDERS.google && !AUTH_PROVIDERS.github) {
          const warning = document.getElementById('providerSetup');
          if (warning) warning.hidden = false;
        }
        if (!AUTH_PROVIDERS.google) document.querySelector('.auth-btn-google')?.setAttribute('hidden', '');
        if (!AUTH_PROVIDERS.github) document.querySelector('.auth-btn-github')?.setAttribute('hidden', '');
        return;
      }
      const pageMeta = {
        devices: { title: 'Your devices', description: 'The computers and servers you have connected to ssh-mcp-pro.' },
        'add-device': { title: 'Connect a device', description: 'Add a computer you own and choose what AI can do on it.' },
        clients: { title: 'Connect an AI app', description: 'Use the same secure MCP connection in the assistant you prefer.' },
        'ai-clients': { title: 'AI clients', description: 'Manage AI assistants authorized for your account.' },
        audit: { title: 'Open activity', description: 'Review actions requested through your connected devices.' },
        usage: { title: currentUser.serviceOwner ? 'Usage & Users' : 'Usage', description: 'Tool calls, quota limits, and execution metrics for your account.' },
      }[activeTab] || { title: 'Your devices', description: '' };
      const navSvg = paths => '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
      const navIcons = {
        devices: navSvg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'),
        'add-device': navSvg('<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M12 9v7m-3.5-3.5h7"/>'),
        clients: navSvg('<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3ZM19 18l.7 1.3L21 20l-1.3.7L19 22l-.7-1.3L17 20l1.3-.7L19 18Z"/>'),
        'ai-clients': navSvg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
        audit: navSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
        usage: navSvg('<path d="M4 20V9m5 11V5m5 15v-8m5 8V3"/>'),
      };
      const navItem = (tab, title) => \`
        <button type="button" data-dashboard-tab="\${tab}" aria-current="\${activeTab === tab ? 'page' : 'false'}"
          class="workspace-nav-item \${activeTab === tab ? 'active' : ''}" onclick="switchTab('\${tab}')">
          <span class="workspace-nav-icon" aria-hidden="true">\${navIcons[tab]}</span><span>\${title}</span>
        </button>\`;
      const renderSidebarUsageWidget = () => {
        const u = (currentUser && currentUser.userUsage) || (usageData && usageData.userUsage) || {
          callsThisMonth: 0,
          limit: 10000,
          percentUsed: 0,
          resetDate: '1 Ara'
        };
        const n = value => new Intl.NumberFormat('en-US').format(Number(value || 0));
        return \`
          <div class="sidebar-usage-widget">
            <div class="sidebar-usage-header">
              <span class="sidebar-usage-label">Tool calls</span>
              <span class="sidebar-usage-pct">\${u.percentUsed}%</span>
            </div>
            <div class="sidebar-progress-track">
              <div class="sidebar-progress-fill" style="width:\${u.percentUsed}%;"></div>
            </div>
            <div class="sidebar-usage-detail">\${n(u.callsThisMonth)} of \${n(u.limit)} this month</div>
            <div class="sidebar-usage-reset">Resets on \${escapeHtml(u.resetDate)}</div>
            <button class="sidebar-upgrade-btn" type="button" onclick="switchTab('usage')">Upgrade to Pro</button>
          </div>
        \`;
      };
      const online = devicesList.filter(d => d.isLiveConnected).length;
      const total = devicesList.length;
      root.innerHTML = \`
        <div class="workspace-shell">
          <aside class="workspace-sidebar">
            <a href="/dashboard" class="sidebar-brand" aria-label="ssh-mcp-pro workspace">
              <img src="/brand/ssh-mcp-pro-icon.png?v=${DASHBOARD_BRAND_FINGERPRINT}" alt="ssh-mcp-pro" width="46" height="46" class="brand-mark">
              <span><strong>ssh-mcp-pro</strong><small>Cloud workspace</small></span>
            </a>
            <p class="sidebar-label">WORKSPACE</p>
            <nav class="workspace-nav" aria-label="Workspace navigation">
              \${navItem('devices', 'Devices')}
              \${currentUser.serviceOwner ? navItem('usage', 'Usage & Users') : navItem('usage', 'Usage')}
              \${navItem('add-device', 'Add a device')}
              \${navItem('clients', 'AI connections')}
              \${navItem('ai-clients', 'AI clients')}
              \${navItem('audit', 'Activity')}
            </nav>
            <div class="sidebar-bottom">
              \${renderSidebarUsageWidget()}
              <div class="sidebar-account">
                <span class="account-avatar" aria-hidden="true">\${escapeHtml((currentUser.displayName || currentUser.id || 'S').slice(0, 1).toUpperCase())}</span>
                <span class="sidebar-account-text"><strong>\${escapeHtml(currentUser.displayName || 'Signed in')}</strong><small>\${escapeHtml(currentUser.email || (currentUser.provider === 'github' ? 'GitHub account' : 'Google account'))}</small></span>
                <a href="/auth/logout" class="sidebar-signout" aria-label="Sign out" title="Sign out">Sign out</a>
              </div>
              <div class="sidebar-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/oaslananka/ssh-mcp-pro/issues" rel="noopener noreferrer">Help</a></div>
            </div>
          </aside>
          <main class="workspace-main" id="mainContent">
            <div class="workspace-topbar">
              <span class="workspace-breadcrumb">Workspace <span aria-hidden="true">/</span> \${escapeHtml(pageMeta.title)}</span>
              <div class="workspace-top-status"><span class="live-indicator" aria-hidden="true"></span> Signed in with \${escapeHtml(currentUser.provider === 'github' ? 'GitHub' : 'Google')}</div>
            </div>
            <div class="workspace-page-heading">
              <div><p class="eyebrow">\${activeTab === 'ai-clients' ? 'AI ACCESS · YOUR CONTROL' : 'YOUR DEVICES · YOUR CONTROL'}</p><h1>\${escapeHtml(pageMeta.title)}</h1><p>\${escapeHtml(pageMeta.description)}</p></div>
              \${activeTab === 'ai-clients' ? '' : activeTab !== 'add-device' ? '<button class="btn btn-primary" type="button" onclick="switchTab(\\'add-device\\')"><span aria-hidden="true">+</span> Add a device</button>' : '<button class="btn btn-outline" type="button" onclick="switchTab(\\'devices\\')">Back to devices</button>'}
            </div>
            \${activeTab === 'devices' ? \`
              <section class="connection-summary" aria-label="Connection overview">
                <div class="connection-summary-primary"><span class="summary-pulse" aria-hidden="true"></span><div>
                  <strong>\${devicesError ? 'Device status unavailable' : !devicesLoaded ? 'Checking your devices…' : online > 0 ? "You're ready to work" : total > 0 ? 'Your devices are offline' : 'Connect your first device'}</strong>
                  <span>\${devicesError ? 'Please retry to check the current device status' : !devicesLoaded ? 'Loading live connection status' : online > 0 ? online + ' connected device' + (online === 1 ? '' : 's') + ' · Connect an AI app to start' : total > 0 ? 'Check the agent on your computer to reconnect' : 'Your AI assistant needs a connected computer to get started'}</span>
                </div></div>
                \${devicesLoaded && !devicesError && total > 0 ? \`<button class="btn btn-soft" type="button" onclick="\${online > 0 ? "switchTab('clients')" : 'retryDevices()'}">\${online > 0 ? 'Connect an AI app' : 'Check connection'} <span aria-hidden="true">→</span></button>\` : ''}
              </section>
              \${!devicesLoaded ? '' : total > 0 ? '<p class="device-scope-note" role="note">Showing devices for your ' + escapeHtml(currentUser.provider === 'github' ? 'GitHub' : 'Google') + ' account. Other sign-in providers have separate device lists.</p>' : ''}
            \` : ''}
            <div id="tabContent">\${renderTabContent()}</div>
          </main>
        </div>
      \`;
      if (activeTab === 'devices' && !devicesLoaded) loadDevices();
      if (activeTab === 'add-device') chooseInstallOS(selectedInstallOs);
      if (activeTab === 'ai-clients') loadAiClients();
      if (activeTab === 'audit') loadAudit();
      if (activeTab === 'usage') loadUsage();
    }

    function chooseInstallOS(os) {
      if (!['windows', 'linux', 'macos'].includes(os)) return;
      selectedInstallOs = os;
      document.querySelectorAll?.('[data-install-os]').forEach(button => {
        const selected = button.getAttribute('data-install-os') === os;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('active', selected);
      });
      document.querySelectorAll?.('[data-os-section]').forEach(section => {
        section.hidden = section.getAttribute('data-os-section') !== os;
      });
    }

    function switchTab(tab) {
      stopEnrollmentPolling();
      if (tab === 'devices' && activeTab !== tab) { devicesLoaded = false; devicesError = ''; }
      if (tab === 'audit' && activeTab !== tab) { auditLoaded = false; auditError = ''; }
      if (tab === 'ai-clients' && activeTab !== tab) { aiClientsLoaded = false; aiClientsError = ''; }
      activeTab = tab;
      renderApp();
      document.querySelector('[data-dashboard-tab="' + tab + '"]')?.focus({ preventScroll: true });
    }

${DASHBOARD_PAGE_RENDER_SCRIPT}${DASHBOARD_AI_CLIENT_SCRIPT}    function renderUsagePanel() {
      if (!usageData) return '<div class="card" role="status">Loading usage…</div>';
      const n = value => new Intl.NumberFormat('en-US').format(Number(value || 0));
      const u = usageData.userUsage || usageData;
      const callsThisMonth = u.callsThisMonth ?? 0;
      const limit = u.limit ?? 10000;
      const remaining = Math.max(0, limit - callsThisMonth);
      const percentUsed = u.percentUsed ?? Math.min(100, Math.round((callsThisMonth / limit) * 100));
      const dailyAvg = u.dailyAverage ?? 0;
      const resetDate = u.resetDate || '1 Ara';
      const daysRemaining = u.daysRemaining ?? 10;
      const history = (u.callsOverTime && u.callsOverTime.length) ? u.callsOverTime : [
        { month: 'Haz', count: 0 },
        { month: 'Tem', count: 0 },
        { month: 'Ağu', count: 0 },
        { month: 'Eyl', count: 0 },
        { month: 'Eki', count: 0 },
        { month: 'Kas', count: callsThisMonth }
      ];
      const maxHistory = Math.max(10000, ...history.map(h => h.count));

      let html = \`
        <div class="usage-banner">
          <div>
            <h3>\${n(remaining)} tool calls left this month, resets on \${escapeHtml(resetDate)}</h3>
            <p>Pro removes the monthly limit — $20 / month, plus VAT and other applicable taxes.</p>
          </div>
          <button class="usage-banner-btn" type="button" onclick="alert('Pro upgrade: available through billing portal.')">Upgrade to Pro</button>
        </div>

        <div class="usage-stat-grid">
          <div class="usage-card">
            <div class="usage-card-label">Tool calls this month</div>
            <div class="usage-stat-val">
              <span class="stat-number-big">\${n(callsThisMonth)}</span>
              <span class="stat-number-limit">/ \${n(limit)}</span>
            </div>
            <div class="usage-progress-bar">
              <div class="usage-progress-fill" style="width:\${percentUsed}%;"></div>
            </div>
            <div class="usage-card-footer">\${percentUsed}% used · Resets on \${escapeHtml(resetDate)}, in \${daysRemaining} days</div>
          </div>
          <div class="usage-card">
            <div class="usage-card-label">Daily average</div>
            <div class="usage-stat-val">
              <span class="stat-number-big">\${n(dailyAvg)}</span>
            </div>
            <div class="usage-card-footer" style="margin-top:28px;">Calls so far this month ÷ days elapsed.</div>
          </div>
        </div>

        <div class="chart-card">
          <h3>Calls over time</h3>
          <p>Last 6 months, grouped by month</p>
          <div class="barchart-container">
            <div class="barchart-y-axis">
              <span>\${n(maxHistory)}</span>
              <span>\${n(Math.round(maxHistory / 2))}</span>
              <span>0</span>
            </div>
            <div class="barchart-grid-lines">
              <div class="barchart-grid-line"></div>
              <div class="barchart-grid-line"></div>
              <div class="barchart-grid-line"></div>
            </div>
            <div class="barchart-bars">
              \${history.map(m => {
                const heightPct = Math.min(100, Math.max(3, Math.round((m.count / maxHistory) * 100)));
                return \`<div class="barchart-col">
                  <div class="barchart-bar" style="height:\${heightPct}%;" title="\${escapeHtml(m.month)}: \${n(m.count)} calls"></div>
                  <span class="barchart-label">\${escapeHtml(m.month)}</span>
                </div>\`;
              }).join('')}
            </div>
          </div>
        </div>
      \`;

      if (currentUser.serviceOwner && usageData.serviceUsage) {
        const su = usageData.serviceUsage;
        const metrics = [
          ['Registered accounts', su.registeredUsers, 'Accounts are not unique people'],
          ['Enrolled devices', su.registeredAgents, 'Online and offline agents'],
          ['Tool calls · 7 days', su.actionsLast7Days, 'Recorded agent actions'],
          ['Tool calls · all time', su.totalActions, 'Not OAuth clients or login events']
        ];
        html += '<section class="usage-head" style="margin-top:28px;"><div><div class="eyebrow">Owner workspace</div><h2>Service overview</h2><p>Live, read-only service statistics for all registered tenants.</p></div><button class="btn btn-outline btn-sm" onclick="loadUsage()">Refresh statistics</button></section>' +
          '<div class="usage-grid">' + metrics.map(item => '<div class="usage-stat"><div class="stat-label">' + escapeHtml(item[0]) + '</div><strong>' + n(item[1]) + '</strong><small>' + escapeHtml(item[2]) + '</small></div>').join('') + '</div>' +
          '<section class="card" style="margin-top:16px;"><h3>Registered accounts</h3><p class="device-scope-note">Visible only to explicitly configured service owners. AI providers and OAuth clients are not additional users.</p><div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Account</th><th>Provider</th><th>Devices</th><th>Tool calls</th><th>Last action</th></tr></thead><tbody>' +
          (su.accounts || []).map(a => '<tr><td>' + escapeHtml(a.label || 'Account') + '</td><td>' + escapeHtml(a.provider) + '</td><td>' + n(a.agents) + '</td><td>' + n(a.actions) + '</td><td>' + escapeHtml(a.lastActionAt ? new Date(a.lastActionAt).toLocaleString() : 'No actions') + '</td></tr>').join('') +
          '</tbody></table></div></section>';
      }
      return html;
    }

    async function loadUsage() {
      const target = document.getElementById('tabContent');
      try {
        const userRes = await fetch('/api/dashboard/user-usage', { cache: 'no-store' });
        if (!userRes.ok) throw new Error('User usage data unavailable');
        const userUsage = await userRes.json();
        usageData = { ...(usageData || {}), userUsage };
        if (currentUser && currentUser.serviceOwner) {
          try {
            const ownerRes = await fetch('/api/dashboard/usage', { cache: 'no-store' });
            if (ownerRes.ok) {
              usageData.serviceUsage = await ownerRes.json();
            }
          } catch (e) {
            console.error('Service usage unavailable', e);
          }
        }
        if (activeTab === 'usage' && target) target.innerHTML = renderUsagePanel();
      } catch (error) {
        if (activeTab === 'usage' && target) {
          target.innerHTML = usageData ? renderUsagePanel() : '<div class="card feedback-error" role="alert"><h2>Could not load usage</h2><p>Please check your connection and try again.</p><button type="button" class="btn btn-primary" onclick="loadUsage()">Retry</button></div>';
        }
      }
    }

    function retryDevices() {
      devicesLoaded = false;
      devicesError = '';
      if (activeTab === 'devices') renderApp();
    }

    async function loadDevices() {
      try {
        const res = await fetch('/api/dashboard/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error('Device API unavailable');
        const data = await res.json();
        devicesList = Array.isArray(data.devices) ? data.devices : [];
        devicesError = '';
      } catch (e) {
        devicesError = 'unavailable';
        console.error('Failed to load devices', e);
      } finally {
        devicesLoaded = true;
        if (activeTab === 'devices') renderApp();
      }
    }

    async function loadAudit() {
      auditLoaded = false;
      auditError = '';
      const target = document.getElementById('tabContent');
      if (activeTab === 'audit' && target) target.innerHTML = renderTabContent();
      try {
        const res = await fetch('/api/dashboard/audit', { cache: 'no-store' });
        if (!res.ok) throw new Error('Activity API unavailable');
        const data = await res.json();
        auditList = Array.isArray(data.events) ? data.events : [];
      } catch (e) {
        auditError = 'unavailable';
        console.error('Failed to load audit events', e);
      } finally {
        auditLoaded = true;
        if (activeTab === 'audit' && target) target.innerHTML = renderTabContent();
      }
    }

    async function changePolicy(id, profile) {
      try {
        const res = await fetch('/api/dashboard/devices/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1' },
          body: JSON.stringify({ policy: { profile } })
        });
        if (res.ok) {
          loadDevices();
        } else {
          alert('Failed to update policy');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function revokeDevice(id) {
      if (!confirm('Revoke access for this device? The agent will disconnect, but its record will remain until removed.')) return;
      try {
        const res = await fetch('/api/dashboard/devices/' + encodeURIComponent(id) + '/revoke', {
          method: 'POST',
          headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        if (res.ok) {
          await loadDevices();
        } else {
          const detail = await res.json().catch(() => ({}));
          alert(detail.error || 'Failed to revoke device');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function removeDevice(id) {
      if (!confirm('Remove this device? Access will be revoked and its device record permanently deleted. Audit history is retained.')) return;
      try {
        const res = await fetch('/api/dashboard/devices/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        if (res.ok) {
          loadDevices();
        } else {
          const detail = await res.json().catch(() => ({}));
          alert(detail.error || 'Failed to remove device');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function copySnippet(id) {
      const source = document.getElementById(id);
      const button = source?.parentElement?.querySelector('.copy-btn');
      if (!source || !button) return;
      const originalLabel = button.dataset.copyLabel || button.getAttribute('aria-label') || 'Copy snippet';
      button.dataset.copyLabel = originalLabel;
      function feedback(label) {
        button.textContent = label;
        button.setAttribute('aria-label', originalLabel + ': ' + label);
        clearTimeout(button.copyResetTimer);
        button.copyResetTimer = setTimeout(() => {
          if (!button.isConnected) return;
          button.textContent = 'Copy';
          button.setAttribute('aria-label', originalLabel);
        }, 1800);
      }
      if (!navigator.clipboard?.writeText) {
        feedback('Unavailable');
        return;
      }
      navigator.clipboard.writeText(source.textContent || '')
        .then(() => feedback('Copied'))
        .catch(() => feedback('Copy failed'));
    }

    renderHeader();
    renderApp();
  </script>
  <footer class="site-footer"><span>ssh-mcp-pro · Designed for controlled remote operations</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="https://github.com/oaslananka/ssh-mcp-pro/issues" rel="noopener noreferrer">Support</a></span></footer>
</body>
</html>`;
}
