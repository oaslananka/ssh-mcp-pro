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

    function renderLanding() {
      return \`
        <div class="landing-shell">
          <section class="landing-hero">
            <div class="landing-copy">
              <div class="eyebrow"><span class="mini-spark" aria-hidden="true"></span> ZERO-TRUST SSH CONTROL PLANE · MCP SERVER</div>
              <h1>Your machines. <em>Inside your AI chat.</em></h1>
              <p>Connect your workstations and servers to ChatGPT, Claude or Gemini with strict SSH Model Context Protocol access. Strict host-key checking, non-root enforcement, and tamper-evident audit logs.</p>
              <div class="auth-buttons">
                <a href="/auth/login/google" class="auth-btn auth-btn-google">
                  <span class="google-icon" aria-hidden="true">G</span> Continue with Google
                </a>
                <a href="/auth/login/github" class="auth-btn auth-btn-github">
                  <span class="github-icon" aria-hidden="true">⌘</span> Continue with GitHub
                </a>
              </div>
              <div class="landing-specs" aria-label="Security specifications">
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Strict host-key check</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Non-root isolation</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Zero sudo default</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>SHA-256 audit chaining</span>
              </div>
              <p class="landing-small-note">Already connected a device? Sign in with the same account to find it.</p>
              <p id="providerSetup" class="device-scope-note" role="status" hidden>Local sign-in is not configured yet. Configure a supported OAuth provider or use the <a href="https://ssh-mcp-pro.oaslananka.dev/">hosted dashboard</a>.</p>
            </div>
            <div class="product-stage" aria-label="Illustration of ssh-mcp-pro connecting AI clients to your device. Not a live session.">
              <div class="stage-overline">WORK WITH YOUR FAVORITE ASSISTANT</div>
              <div class="stage-clients">
                <div class="assistant-chip"><span class="assistant-mark gpt-mark" aria-hidden="true">✳</span> ChatGPT<span class="chip-status">OpenAI MCP</span></div>
                <div class="assistant-chip"><span class="assistant-mark claude-mark" aria-hidden="true">✺</span> Claude<span class="chip-status">Desktop &amp; Web</span></div>
                <div class="assistant-chip"><span class="assistant-mark gemini-mark" aria-hidden="true">✦</span> Gemini<span class="chip-status">CLI &amp; Custom Apps</span></div>
              </div>
              <div class="stage-connector" aria-hidden="true"><span></span><i></i><span></span></div>
              <div class="stage-gateway">
                <img src="/brand/ssh-mcp-pro-icon.png?v=${DASHBOARD_BRAND_FINGERPRINT}" width="64" height="64" alt="" aria-hidden="true">
                <div><strong>ssh-mcp-pro</strong><small>One secure connection. Your rules.</small></div>
                <span class="stage-shield" aria-label="Policy controlled">✓</span>
              </div>
              <div class="stage-connector short" aria-hidden="true"><span></span><i></i><span></span></div>
              <div class="terminal-preview" role="region" aria-label="Interactive terminal preview">
                <div class="terminal-titlebar"><span class="terminal-host-badge"><i aria-hidden="true"></i> srv-prod-01 (Ubuntu 24.04 LTS)</span><span class="terminal-policy-badge">STRICT ENFORCE</span><span class="terminal-sample">Illustrative preview</span></div>
                <div class="terminal-content">
                  <div class="terminal-line"><span class="terminal-caller">claude</span><span class="terminal-dollar" aria-hidden="true">›</span> <span class="term-fn">proc_exec</span>(<span class="term-arg">"systemctl is-active docker"</span>)</div>
                  <div class="terminal-result"><span class="mini-spark" aria-hidden="true"></span> [policy-guard] rule: <span class="term-hl">allow-read-only</span> · exit 0</div>
                  <div class="terminal-output">active (running) · 4 containers up</div>
                  <div class="terminal-caption">Run only what your access policy allows. Chained in audit log.</div>
                </div>
              </div>
            </div>
          </section>
          <section class="onboarding-section" aria-labelledby="start-heading">
            <div class="onboarding-section-head"><p class="eyebrow">INTEGRATION FLOW</p><h2 id="start-heading">Quick start: three steps to connected.</h2><p>Zero daemon compile required. Start from sign-in to verified AI execution in three minutes.</p></div>
            <div class="onboarding-steps">
              <article><span class="step-number">01</span><h3>Authenticate workspace</h3><p>Sign in with Google or GitHub to create an isolated cryptographic workspace with automatic keypair generation.</p></article>
              <article><span class="step-number">02</span><h3>Enroll host daemon</h3><p>Install the lightweight agent on your Windows, Linux, or macOS machine. Choose exact scope policies.</p></article>
              <article><span class="step-number">03</span><h3>Connect AI assistant</h3><p>Use the secure MCP endpoint from ChatGPT, Claude or Gemini and start working.</p></article>
            </div>
          </section>
          <section class="landing-local"><div><span class="landing-local-symbol" aria-hidden="true">⌘</span><div><h2>Prefer to stay local?</h2><p>Start your own local dashboard. Sign-in requires a Google or GitHub OAuth provider.</p></div></div><code>npx -y ssh-mcp-pro web</code></section>
        </div>
      \`;
    }

    function renderTabContent() {
      if (activeTab === 'usage') return renderUsagePanel();

      if (activeTab === 'devices') {
        if (!devicesLoaded) {
          return '<div class="card device-loading" role="status">Loading your connected devices…</div>';
        }
        if (devicesError) {
          return '<div class="card feedback-error" role="alert"><h2>Could not load your devices</h2><p>Check your internet connection and try again. Your existing devices and permissions have not been changed.</p><button type="button" class="btn btn-primary" onclick="retryDevices()">Try again</button></div>';
        }
        if (devicesList.length === 0) {
          return \`<div class="card empty-box onboarding-empty">
            <div class="empty-art" aria-hidden="true"><span>▣</span><span class="empty-plus">+</span></div>
            <h2>Let's connect your first computer.</h2>
            <p>Add your own desktop, laptop or server. You decide what your AI assistant can do.</p>
            <button class="btn btn-primary" type="button" onclick="switchTab('add-device')">Connect a device <span aria-hidden="true">→</span></button>
            <div class="empty-next-step">Next: <strong>Connect an AI app</strong> after the device is online.</div>
          </div>\`;
        }
        return \`<section class="device-list-card card" aria-label="Your enrolled devices">
          <div class="device-list-heading"><div><h2>Your devices</h2><p>\${devicesList.length} enrolled · \${devicesList.filter(d => d.isLiveConnected).length} online</p></div><div class="device-list-tools"><button class="btn btn-outline btn-sm" type="button" onclick="switchTab('audit')">Open activity</button> <button class="btn btn-outline btn-sm" type="button" onclick="loadDevices()">Refresh</button></div></div>
          <div class="device-list-body">
          \${devicesList.map(dev => \`
            <article class="device-entry">
              <div class="device-row">
                <div class="device-info">
                  <div class="device-icon" aria-hidden="true">\${dev.host_metadata?.platform === 'win32' ? '▣' : dev.host_metadata?.platform === 'darwin' ? '⌘' : '⌁'}</div>
                  <div class="device-ident"><div class="device-name">\${escapeHtml(dev.alias)}</div>
                  <div class="device-meta">\${escapeHtml(dev.host_metadata?.os || dev.host_metadata?.platform || 'Computer')} · \${escapeHtml(dev.host_metadata?.hostname || 'Device')} · \${escapeHtml(dev.profile)}</div><div class="device-meta">AI access: \${Array.isArray(dev.aiConnections) && dev.aiConnections.length ? escapeHtml(dev.aiConnections.map(c => c.name).join(', ')) : 'No explicitly shared AI connections'}\${strictVisibilityEnabled ? '' : ' · Legacy connections may still have access'}</div></div>
                </div>
                <div class="device-row-status"><span class="status-pill \${dev.isLiveConnected ? 'online' : 'offline'}"><span aria-hidden="true"></span>\${dev.isLiveConnected ? 'Online' : dev.status === 'revoked' ? 'Access revoked' : 'Offline'}</span>
                  <details class="device-controls">
                    <summary>Manage <span aria-hidden="true">⌄</span></summary>
                    <div class="device-control-panel">
                      <h3>Advanced device controls</h3>
                      <p>Permission changes affect what this device can do. You can revoke or remove it at any time.</p>
                      <p class="device-technical-meta">Host: \${escapeHtml(dev.host_metadata?.hostname || 'Not reported')} · OS: \${escapeHtml(dev.host_metadata?.os || 'Not reported')} · Architecture: \${escapeHtml(dev.host_metadata?.arch || 'Not reported')} · Platform: \${escapeHtml(dev.host_metadata?.platform || 'Not reported')} · Policy v\${escapeHtml(dev.policy_version ?? '—')}</p>
                      <label for="profile-\${escapeHtml(dev.id)}">Permission profile</label>
                      <select id="profile-\${escapeHtml(dev.id)}" aria-label="Policy for \${escapeHtml(dev.alias)}" class="btn btn-outline btn-sm" onchange="changePolicy('\${dev.id}', this.value)" \${dev.status === 'revoked' ? 'disabled' : ''}>
                        <option value="read-only" \${dev.profile === 'read-only' ? 'selected' : ''}>Read only</option>
                        <option value="operations" \${dev.profile === 'operations' ? 'selected' : ''}>Operations</option>
                        <option value="full-admin" \${dev.profile === 'full-admin' ? 'selected' : ''}>Full admin</option>
                      </select>
                      <div class="device-control-actions"><button class="btn btn-outline btn-sm" type="button" onclick="revokeDevice('\${dev.id}')" \${dev.status === 'revoked' ? 'disabled' : ''}>\${dev.status === 'revoked' ? 'Revoked' : 'Revoke access'}</button>
                      <button class="btn btn-danger btn-sm" type="button" onclick="removeDevice('\${dev.id}')">Remove device</button></div>
                    </div>
                  </details>
                </div>
              </div>
              \${!dev.isLiveConnected && dev.status !== 'revoked' ? '<div class="device-offline-tip">Agent offline — start ssh-mcp-pro Agent on this computer to reconnect. <a href="https://github.com/oaslananka/ssh-mcp-pro/blob/main/docs/adding-a-device.md" target="_blank" rel="noopener noreferrer">Connection help</a></div>' : ''}
            </article>
          \`).join('')}
          </div>
        </section>
        \`;
      }

      if (activeTab === 'add-device') {
        return \`
          <div class="device-wizard">
            <div class="wizard-stepper">
              <div class="stepper-item active">
                <div class="stepper-dot"></div>
                <span>Choose method</span>
              </div>
              <div class="stepper-line"></div>
              <div class="stepper-item">
                <div class="stepper-dot"></div>
                <span>Start on device</span>
              </div>
              <div class="stepper-line"></div>
              <div class="stepper-item">
                <div class="stepper-dot"></div>
                <span>Verify</span>
              </div>
            </div>

            <h2 class="wizard-title">Connect this device</h2>
            <p class="wizard-subtitle">Desktop Commander Remote runs on this device so your AI chat can work with your files. Choose how to connect.</p>

            <div class="platform-segmented" role="tablist">
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'windows' ? 'active' : ''}" data-install-os="windows" onclick="chooseInstallOS('windows')">Windows</button>
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'macos' ? 'active' : ''}" data-install-os="macos" onclick="chooseInstallOS('macos')">macOS</button>
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'linux' ? 'active' : ''}" data-install-os="linux" onclick="chooseInstallOS('linux')">Linux</button>
            </div>

            <p class="wizard-note">Choose one method. You can change it anytime.</p>

            <!-- Windows methods -->
            <div data-os-section="windows" \${selectedInstallOs === 'windows' ? '' : 'hidden'}>
              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Download and run <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Easiest option. No commands to type.</p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">PowerShell setup script</div>
                </div>
                <p class="wizard-method-desc">One command. Installs Node.js if needed.</p>
                <div class="wizard-codebox">
                  <code id="cmdWinOneLiner">irm -ErrorAction Stop \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-windows.ps1 | iex</code>
                  <button type="button" class="wizard-copy-btn" onclick="copySnippet('cmdWinOneLiner')">Copy</button>
                </div>
                <p style="font-size:11px; color:#647083; margin-top:8px;">After copying, we'll show you how to open PowerShell and run the command.</p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">npx (advanced)</div>
                </div>
                <p class="wizard-method-desc">Requires Node.js 22.12+ already installed.</p>
                <div class="wizard-codebox">
                  <code id="cmdWinNpx">npx.cmd ssh-mcp-pro@latest remote</code>
                  <button type="button" class="wizard-copy-btn" onclick="copySnippet('cmdWinNpx')">Copy</button>
                </div>
                <p style="font-size:11px; color:#647083; margin-top:8px;">After copying, we'll show you how to open PowerShell and run the command.</p>
              </div>
            </div>

            <!-- macOS methods -->
            <div data-os-section="macos" \${selectedInstallOs === 'macos' ? '' : 'hidden'}>
              <div class="wizard-method-card" style="cursor:default;">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Quick setup <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Starts ssh-mcp-pro. If Node.js can't be found, you'll be asked before installing it.</p>
                <div class="wizard-codebox">
                  <code id="cmdMacOneLiner">$ curl -fsSL \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-macos.sh | sh</code>
                </div>
                <button type="button" class="wizard-btn-primary" onclick="copySnippet('cmdMacOneLiner')">Copy setup command</button>
                <p style="text-align:center; font-size:11px; color:#647083; margin-top:10px;"><a href="https://github.com/oaslananka/ssh-mcp-pro" target="_blank" rel="noopener noreferrer" style="color:#647083;">All these scripts are open source. You can view them on GitHub ↗</a></p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Other ways to connect</div>
                </div>
                <p class="wizard-method-desc">Use your own Node.js installation (Requires Node.js 22.12 or newer)</p>
                <div class="wizard-codebox">
                  <code id="cmdMacNpx">npx ssh-mcp-pro@latest remote</code>
                </div>
                <button type="button" class="btn btn-outline" style="width:100%; margin-top:8px;" onclick="copySnippet('cmdMacNpx')">Copy npx command</button>
              </div>
            </div>

            <!-- Linux methods -->
            <div data-os-section="linux" \${selectedInstallOs === 'linux' ? '' : 'hidden'}>
              <div class="wizard-method-card" style="cursor:default;">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Quick setup <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Starts ssh-mcp-pro. If Node.js can't be found, you'll be asked before installing it.</p>
                <div class="wizard-codebox">
                  <code id="cmdLinuxOneLiner">$ curl -fsSL \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-linux.sh | sh</code>
                </div>
                <button type="button" class="wizard-btn-primary" onclick="copySnippet('cmdLinuxOneLiner')">Copy setup command</button>
                <p style="text-align:center; font-size:11px; color:#647083; margin-top:10px;"><a href="https://github.com/oaslananka/ssh-mcp-pro" target="_blank" rel="noopener noreferrer" style="color:#647083;">All these scripts are open source. You can view them on GitHub ↗</a></p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Other ways to connect</div>
                </div>
                <p class="wizard-method-desc">Use your own Node.js installation (Requires Node.js 22.12 or newer)</p>
                <div class="wizard-codebox">
                  <code id="cmdLinuxNpx">npx ssh-mcp-pro@latest remote</code>
                </div>
                <button type="button" class="btn btn-outline" style="width:100%; margin-top:8px;" onclick="copySnippet('cmdLinuxNpx')">Copy npx command</button>
              </div>
            </div>

            <div class="wizard-footer-link">
              Want to use a server we host instead of your own computer? <a href="https://github.com/oaslananka/ssh-mcp-pro/issues" target="_blank" rel="noopener noreferrer">Tell us ↗</a>
            </div>
          </div>

          <div class="card" style="max-width:620px; margin:0 auto 30px;">
            <h2 style="margin-bottom:12px; font-size:17px;">Custom enrollment & approvals</h2>
            <p style="color:var(--text-muted); font-size:13px; margin-bottom:20px;">\${localBrowserLink ? 'Approve the local agent waiting in your terminal. The one-time credential stays inside your browser and device; do not copy it into chat.' : 'Optionally generate custom named tokens or approve waiting terminals.'}</p>
            \${localBrowserLink ? '<p style="color:var(--text-muted); font-size:13px; margin-bottom:16px;">Chrome may ask to access other apps and services on this device. Bring this browser window to the front and choose Allow for this trusted site. If the prompt is hidden, check Chrome’s address bar; the connection check stops after one minute so you can retry.</p>' : ''}
            <div class="os-chooser" aria-label="Choose device operating system" role="group">
              <span>Which operating system?</span>
              <div class="os-chooser-options">
                <button type="button" class="os-choice active" data-install-os="windows" aria-pressed="true" onclick="chooseInstallOS('windows')">Windows</button>
                <button type="button" class="os-choice" data-install-os="linux" aria-pressed="false" onclick="chooseInstallOS('linux')">Linux / WSL</button>
                <button type="button" class="os-choice" data-install-os="macos" aria-pressed="false" onclick="chooseInstallOS('macos')">macOS</button>
              </div>
            </div>
            <div data-os-section="linux" style="display:\${localBrowserLink ? 'none' : 'block'}; margin-bottom:20px; padding:14px; border:1px solid var(--card-border); border-radius:8px;">
              <h3 style="margin-bottom:8px; font-size:14px;">Linux / WSL: Set up with your browser</h3>
              <p style="color:var(--text-muted); font-size:13px; margin-bottom:12px;">Copy this command to the device you want to enroll. Open the URL printed in its terminal in a browser on that same device, sign in and approve. No token copying or sudo required.</p>
              <div class="code-box">
                <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy token-free Linux browser setup" onclick="copySnippet('cmdBrowser')">Copy</button>
                <span id="cmdBrowser">\${escapeHtml(BROWSER_LINUX_COMMAND)}</span>
              </div>
            </div>
            <div style="display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap;">
              <div style="flex:1; min-width:240px;">
                <label for="enrollAlias" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Device name</label>
                <input id="enrollAlias" type="text" placeholder="e.g. production-bastion, home-server" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
              </div>
              <div style="flex:1; min-width:240px;">
                <label for="enrollProfile" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Access level</label>
                <select id="enrollProfile" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
                  <option value="read-only" selected>Read-Only (Status, Logs, Read Files)</option>
                  <option value="operations">Operations (Restart Services, Docker, Safe Shell)</option>
                  <option value="full-admin">Full Admin (Root sudo, File Write, Service Admin)</option>
                </select>
              </div>
            </div>
            <button id="generateEnrollmentButton" type="button" class="btn btn-primary" onclick="generateEnrollment()">\${localBrowserLink ? 'Approve This Device' : 'Generate setup commands'}</button>
            <p id="enrollError" role="alert" hidden style="color:var(--danger, #f85149); margin-top:12px;"></p>

            <div id="enrollOutput" style="margin-top:24px; display:none;">
              <p id="enrollStatus" role="status" aria-live="polite" style="margin-bottom:12px; color:var(--text-muted);"></p>
              <button id="enrollViewDevice" type="button" class="btn btn-primary" hidden style="display:none; margin-bottom:16px;" onclick="switchTab('devices')">View connected device</button>
              <div id="manualInstallCommands" style="display:\${localBrowserLink ? 'none' : 'block'};">
              <h3 style="margin-bottom:12px; color:#fff;">Step 2 — Run the setup command for your system:</h3>

              <div data-os-section="linux" style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🐧 Linux (systemd)</div>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Linux install command" onclick="copySnippet('cmdLinux')">Copy</button>
                  <span id="cmdLinux"></span>
                </div>
              </div>

              <div data-os-section="windows" style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🪟 Windows (PowerShell)</div>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Windows install command" onclick="copySnippet('cmdWindows')">Copy</button>
                  <span id="cmdWindows"></span>
                </div>
              </div>

              <div data-os-section="macos">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">📦 Manual Node CLI (foreground)</div>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Advanced Linux/macOS fallback: the terminal must stay open. Use an OS service installer for automatic restart.</p>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Node install command" onclick="copySnippet('cmdNpm')">Copy</button>
                  <span id="cmdNpm"></span>
                </div>
              </div>
              </div>
            </div>
          </div>
        \`;
      }

      if (activeTab === 'clients') {
        return \`
          <section class="integration-feature">
            <p class="eyebrow">ONE SECURE CONNECTION</p>
            <h2>Connect your favorite AI assistant</h2>
            <p>Copy this MCP server URL into the app you use, then sign in with the same account as your devices.</p>
            <div class="code-box connection-url"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy MCP server URL" onclick="copySnippet('sharedMcpUrl')">Copy URL</button><span id="sharedMcpUrl">\${MCP_URL}</span></div>
          </section>
          <div class="platform-grid" aria-label="AI app connection instructions">
            <article class="platform-card"><span class="platform-symbol chatgpt" aria-hidden="true">✳</span><h3>ChatGPT</h3><p>In a supported workspace, open Plugins and add a custom MCP server. Paste the URL above and authorize access.</p><small>ChatGPT Work · OAuth connection</small></article>
            <article class="platform-card"><span class="platform-symbol claude" aria-hidden="true">✴</span><h3>Claude</h3><p>Open Customize → Connectors → Add custom connector. Paste the URL and sign in.</p><small>Claude Web · Custom connector</small></article>
            <article class="platform-card"><span class="platform-symbol gemini" aria-hidden="true">✦</span><h3>Gemini</h3><p>Eligible Developer Mode users can add the MCP server. Google registration and review are separate.</p><small>Gemini Web · Developer Mode</small></article>
          </div>
          <div class="integration-next"><span class="live-indicator" aria-hidden="true"></span><p>Choose an online device in your AI chat after connecting. Available tools depend on your account and its permissions.</p></div>
          <details class="advanced-integrations">
            <summary>Advanced setup and configuration examples <span aria-hidden="true">⌄</span></summary>
            <div class="grid-2">
            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">🤖</span>
                <h3>Claude Desktop & Claude Code</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">For remote access in Claude or Claude Desktop: <strong>Customize &gt; Connectors &gt; Add custom connector</strong>, enter this URL, then sign in. Local Desktop servers still use <code>claude_desktop_config.json</code>.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue);">Claude remote custom connector URL:</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude remote MCP URL" onclick="copySnippet('cfgClaudeRemote')">Copy</button><span id="cfgClaudeRemote">\${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Claude Code remote (run in a terminal):</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude Code command" onclick="copySnippet('cfgClaudeCode')">Copy</button><span id="cfgClaudeCode">claude mcp add --transport http ssh-mcp-pro \${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:#7ee787; margin-top:12px;">Claude Desktop local stdio:</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude Desktop config" onclick="copySnippet('cfgClaudeLocal')">Copy</button><span id="cfgClaudeLocal">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "command": "ssh-mcp-pro",\\n      "args": []\\n    }\\n  }\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💬</span>
                <h3>ChatGPT MCP Plugin</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">In supported ChatGPT workspaces, open <strong>Plugins &gt; Add custom MCP server</strong>, paste the URL below and configure OAuth. Custom GPT Actions are a separate OpenAPI-based feature.</p>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy ChatGPT MCP URL" onclick="copySnippet('cfgChatGptMcp')">Copy</button><span id="cfgChatGptMcp">\${MCP_URL}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">✨</span>
                <h3>Gemini API (Interactions)</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Use this Remote MCP tool definition with the Gemini API Interactions endpoint. Configure a valid OAuth bearer credential separately (for example via managed agent credentials); the URL alone does not authenticate. This is not a Gemini web-extension manifest. <a href="https://ai.google.dev/gemini-api/docs/function-calling" target="_blank" rel="noopener noreferrer">Gemini Remote MCP docs</a>.</p>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Gemini MCP config" onclick="copySnippet('cfgGemini')">Copy</button><span id="cfgGemini">{\\n  "type": "mcp_server",\\n  "name": "ssh_mcp_pro",\\n  "url": "\${MCP_URL}"\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💻</span>
                <h3>VS Code / Cursor / Windsurf</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Copy the configuration for your chosen client. VS Code/Copilot portable files use <code>mcpServers</code>; the VS Code workspace format uses <code>servers</code>. Sign in through your client&#39;s OAuth flow.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Copilot portable — <code>.mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy VS Code portable config" onclick="copySnippet('cfgVsCodePortable')">Copy</button><span id="cfgVsCodePortable">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">VS Code workspace (compatible) — <code>.vscode/mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy VS Code workspace config" onclick="copySnippet('cfgVsCode')">Copy</button><span id="cfgVsCode">{\\n  "servers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Cursor — <code>.cursor/mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Cursor MCP config" onclick="copySnippet('cfgCursor')">Copy</button><span id="cfgCursor">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Windsurf — <code>mcp_config.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Windsurf MCP config" onclick="copySnippet('cfgWindsurf')">Copy</button><span id="cfgWindsurf">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "serverUrl": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
            </div>
          </div>
          </details>
        \`;
      }

      if (activeTab === 'ai-clients') return renderAiClientsPanel();

      if (activeTab === 'audit') {
        if (!auditLoaded) return '<div class="card device-loading" role="status">Loading activity…</div>';
        if (auditError) return '<div class="card feedback-error" role="alert"><h2>Could not load activity</h2><p>Recent events are unavailable. Check your connection and try again.</p><button type="button" class="btn btn-primary" onclick="loadAudit()">Try again</button></div>';
        if (auditList.length === 0) {
          return '<div class="card empty-box">No audit events recorded yet.</div>';
        }
        return \`
          <div class="card" style="padding:0; overflow:hidden; border:1px solid #1e2430; border-radius:14px;">
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
              <thead style="background:#151922; border-bottom:1px solid #1e2430;">
                <tr>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Timestamp</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Event</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Severity</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Target</th>
                </tr>
              </thead>
              <tbody>
                \${auditList.map(e => \`
                  <tr style="border-bottom:1px solid #1a202c; transition:background .15s ease;">
                    <td style="padding:14px 18px; font-family:var(--font-mono); color:var(--text-muted); font-size:12px;">\${new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td style="padding:14px 18px; font-weight:600; color:#ffffff;">\${escapeHtml(e.eventType)}</td>
                    <td style="padding:14px 18px;"><span class="badge \${e.severity === 'info' ? 'badge-blue' : (e.severity === 'warn' ? 'badge-green' : 'badge-gray')}">\${e.severity}</span></td>
                    <td style="padding:14px 18px; font-family:var(--font-mono); color:var(--text-muted); font-size:12px;">\${escapeHtml(e.agentAlias || e.agentId || e.actionId || '-')}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      }
    }

    function renderAiConnectionCards() {
      if (!aiConnectionsList.length) {
        return '<section class="card ai-clients-empty"><h3>No device-scoped connections yet</h3>' +
          '<p>Authorize an AI app first. Then select which devices it may see. Older connections can reconnect to become individually managed.</p></section>';
      }
      return '<section class="ai-connection-grid" aria-label="AI device access">' +
        aiConnectionsList.map((connection, i) => {
          const active = connection.status === 'active';
          const selected = new Set(connection.deviceIds || []);
          const choices = devicesError ? '<p role="alert">Devices unavailable. Refresh to retry.</p>' :
            devicesList.filter(device => device.status !== 'revoked').map(device => {
              const choiceId = 'ai-connection-' + i + '-' + device.id;
              return '<label class="ai-device-choice" for="' + escapeHtml(choiceId) + '">' +
                '<input id="' + escapeHtml(choiceId) + '" type="checkbox" data-ai-index="' + i +
                '" value="' + escapeHtml(device.id) + '" ' +
                (selected.has(device.id) ? 'checked ' : '') + (!active ? 'disabled ' : '') + '>' +
                '<span><strong>' + escapeHtml(device.alias) + '</strong><small>' +
                (device.isLiveConnected ? 'Online' : 'Offline') + ' · ' +
                escapeHtml(device.profile || 'Device') + '</small></span></label>';
            }).join('');
          return '<article class="card ai-connection-card"><div class="ai-connection-top"><div><h3>' +
            escapeHtml(connection.clientName) + '</h3><small>' +
            escapeHtml((connection.redirectHosts || []).join(', ') || 'Unverified client') +
            '</small></div><span class="status-pill ' + (active ? 'online' : 'offline') + '">' +
            (active ? 'Connected' : 'Disconnected') + '</span></div>' +
            '<p class="ai-connection-id">Connection ' + escapeHtml(connection.id.slice(-8)) +
            ' · ' + selected.size + ' device(s) allowed</p>' +
            '<fieldset class="ai-device-fieldset" ' + (active ? '' : 'disabled ') +
            '><legend>Devices this AI can access</legend>' +
            (choices || '<p>No devices available. Connect a device first.</p>') + '</fieldset>' +
            (active ? '<div class="ai-client-actions"><button class="btn btn-primary btn-sm" type="button" ' +
              'onclick="saveAiConnectionDevices(' + i + ')"' + (devicesError ? ' disabled' : '') +
              '>Save device access</button><button class="btn btn-outline btn-sm" type="button" ' +
              'onclick="disconnectAiConnection(' + i + ')">Disconnect this AI</button></div>' : '') +
            '</article>';
        }).join('') + '</section>';
    }

    async function saveAiConnectionDevices(i) {
      const connection = aiConnectionsList[i];
      if (!connection || connection.status !== 'active' || devicesError) return;
      const deviceIds = [...document.querySelectorAll('[data-ai-index="' + i + '"]:checked')]
        .map(input => input.value);
      if (!strictVisibilityEnabled &&
          !window.confirm('Enabling device controls requires older unbound AI sessions to reconnect. Continue?')) return;
      try {
        const response = await fetch('/api/dashboard/ai-connections/' +
          encodeURIComponent(connection.id) + '/devices', {
          method: 'PUT', headers: {
            'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1'
          }, body: JSON.stringify({ deviceIds })
        });
        if (!response.ok) throw new Error('Update not confirmed');
        aiClientNotice = 'Device access saved. New AI requests follow these permissions immediately.';
        await loadAiClients();
      } catch {
        aiClientNotice = 'Could not confirm device access changes. Refresh and retry.';
        if (activeTab === 'ai-clients') document.getElementById('tabContent').innerHTML = renderAiClientsPanel();
      }
    }

    async function disconnectAiConnection(i) {
      const connection = aiConnectionsList[i];
      if (!connection || connection.status !== 'active') return;
      if (!window.confirm('Disconnect this AI? Its new requests will be denied; devices stay connected.')) return;
      try {
        const response = await fetch('/api/dashboard/ai-connections/' +
          encodeURIComponent(connection.id) + '/disconnect', {
          method: 'POST', headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        if (!response.ok) throw new Error('Disconnection not confirmed');
        aiClientNotice = 'AI connection disconnected. Your devices are unchanged.';
        await loadAiClients();
      } catch {
        aiClientNotice = 'Could not confirm disconnection. Refresh and retry.';
        if (activeTab === 'ai-clients') document.getElementById('tabContent').innerHTML = renderAiClientsPanel();
      }
    }

    function renderAiClientsPanel() {
      if (!aiClientsLoaded) return '<div class="card device-loading" role="status">Loading AI clients…</div>';
      if (aiClientsError) return '<div class="card feedback-error" role="alert"><h2>AI clients unavailable</h2><p>Your permissions have not changed.</p><button class="btn btn-primary" onclick="loadAiClients()">Retry</button></div>';
      const heading = '<div class="ai-clients-intro"><div><span class="eyebrow">ACCOUNT ACCESS</span><h2>Authorized AI clients</h2><p>Assistants with renewable OAuth grants for this ' + escapeHtml(currentUser.provider === 'google' ? 'Google' : 'GitHub') + ' account.</p></div><button class="btn btn-outline btn-sm" onclick="loadAiClients()">Refresh</button></div>';
      const notice = aiClientNotice ? '<p class="ai-client-notice" role="status">' + escapeHtml(aiClientNotice) + '</p>' : '';
      const deviceControls = renderAiConnectionCards();
      if (!aiClientsList.length) return heading + notice + deviceControls;
      const rows = aiClientsList.map((c, i) => {
        const active = Number(c.activeGrants) > 0;
        const scopes = Array.isArray(c.scopes) ? c.scopes : [];
        const permissions = !active ? 'Disconnected' : scopes.some(s => /:write|:manage|:exec|admin/.test(s)) ? 'Elevated scopes' : 'Read scopes';
        const when = c.lastTokenAt ? new Date(c.lastTokenAt).toLocaleString() : 'Not recorded';
        const created = c.registeredAt ? new Date(c.registeredAt).toLocaleString() : 'Not recorded';
        const hosts = Array.isArray(c.redirectHosts) ? c.redirectHosts.join(', ') : '';
        const detail = 'ai-client-detail-' + i;
        return '<tr><td data-label="Client"><strong>' + escapeHtml(c.clientName) + '</strong><small class="ai-client-id">' + escapeHtml(c.clientId) + '</small></td>' +
          '<td data-label="Redirect host">' + escapeHtml(hosts || 'Unknown') + '</td><td data-label="Created">' + escapeHtml(created) + '</td><td data-label="Last renewal">' + escapeHtml(when) + '</td>' +
          '<td data-label="Active grants"><span class="ai-client-grant ' + (active ? 'is-active' : '') + '">' + Number(c.activeGrants || 0) + '</span></td>' +
          '<td data-label="Permissions">' + escapeHtml(permissions) + '</td><td data-label="Actions"><div class="ai-client-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" aria-controls="' + detail + '" aria-expanded="false" onclick="toggleAiClientDetails(' + i + ', this)">Manage access</button>' +
          '<button type="button" class="btn btn-danger btn-sm" ' + (active ? '' : 'disabled ') + 'onclick="revokeAiClient(' + i + ')">Revoke</button></div></td></tr>' +
          '<tr class="ai-client-details-row" id="' + detail + '" hidden><td colspan="7"><div class="ai-client-details"><strong>Granted OAuth scopes</strong><p>' +
          escapeHtml(scopes.length ? scopes.join(' · ') : 'No active renewable scopes') + '</p><small>Registered ' + escapeHtml(created) + '. To change OAuth scopes, revoke the grant and reconnect. Device policy is enforced separately.</small></div></td></tr>';
      }).join('');
      return heading + notice + deviceControls + '<h3 class="ai-client-section-heading">OAuth client grants</h3>' +
        '<div class="ai-clients-table-wrap"><table class="ai-clients-table"><thead><tr><th>Client</th><th>Redirect host</th><th>Created</th><th>Last renewal</th><th>Active grants</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>' +
        rows + '</tbody></table></div><p class="ai-client-footnote">Shows renewable OAuth grants for this account, not all registered clients. Revocation disables future refreshes, without changing other users or shared registrations. Previously issued access tokens may remain valid until expiry before device restrictions are enabled. Device-scoped connections are checked on each request. Older unbound connections need to reconnect after device controls are enabled. Local stdio MCP has separate permissions.</p>';
    }

    function toggleAiClientDetails(i, button) {
      const details = document.getElementById('ai-client-detail-' + i);
      if (!details) return;
      details.hidden = !details.hidden;
      button.setAttribute('aria-expanded', String(!details.hidden));
    }

    async function loadAiClients() {
      try {
        const response = await fetch('/api/dashboard/ai-clients', { cache: 'no-store' });
        if (!response.ok) throw new Error('AI clients API unavailable');
        const data = await response.json();
        aiClientsList = Array.isArray(data.clients) ? data.clients : [];
        aiConnectionsList = Array.isArray(data.connections) ? data.connections : [];
        strictVisibilityEnabled = data.strictVisibility === true;
        await loadDevices();
        aiClientsError = '';
      } catch (error) {
        aiClientsError = 'unavailable';
        console.error('AI clients request failed', error);
      } finally {
        aiClientsLoaded = true;
        const target = document.getElementById('tabContent');
        if (activeTab === 'ai-clients' && target) target.innerHTML = renderAiClientsPanel();
      }
    }

    async function revokeAiClient(i) {
      const client = aiClientsList[i];
      if (!client || Number(client.activeGrants) < 1) return;
      if (!window.confirm('Revoke ' + client.clientName + ' refresh access for your account? Existing access tokens can remain valid until they expire.')) return;
      try {
        const response = await fetch('/api/dashboard/ai-clients/' + encodeURIComponent(client.clientId) + '/revoke', {
          method: 'POST', headers: { 'X-SSH-MCP-Dashboard': '1' },
        });
        if (!response.ok) throw new Error('Could not revoke client');
        aiClientNotice = 'Renewable access revoked for ' + client.clientName + '.';
        await loadAiClients();
      } catch (error) {
        aiClientNotice = 'Revocation not confirmed. Retry if needed.';
        const target = document.getElementById('tabContent');
        if (activeTab === 'ai-clients' && target) target.innerHTML = renderAiClientsPanel();
      }
    }

    function renderUsagePanel() {
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
