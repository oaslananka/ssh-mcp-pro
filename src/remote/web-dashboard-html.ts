import { buildDashboardBrowserEnrollmentCommand } from "./dashboard-enrollment-commands.js";
import { DASHBOARD_STYLES } from "./web-dashboard-styles.js";
import { BRAND_STYLES } from "./web-dashboard-brand-styles.js";
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
  <title>SSH MCP Pro · Connect your devices to AI</title>
  <meta name="theme-color" content="#0e171b">
  <meta name="description" content="Connect your own devices to ChatGPT, Claude and Gemini with controlled SSH MCP access.">
  <link rel="icon" type="image/png" href="/brand/ssh-mcp-pro-icon.png">
  <link rel="apple-touch-icon" href="/brand/ssh-mcp-pro-icon.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${DASHBOARD_STYLES}
${BRAND_STYLES}</style>
</head>
<body>
  <header class="public-header">
    <a class="logo-area" href="/" aria-label="SSH MCP Pro home">
      <img class="brand-mark" src="/brand/ssh-mcp-pro-icon.png" width="46" height="46" alt="SSH MCP Pro">
      <span><span class="brand-title">SSH MCP Pro</span><span class="brand-sub">Your computers, connected to AI</span></span>
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
    let selectedInstallOs = 'windows';
    let auditList = [];
    let usageData = null;
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
        devices: { title: 'Your devices', description: 'The computers and servers you have connected to SSH MCP Pro.' },
        'add-device': { title: 'Connect a device', description: 'Add a computer you own and choose what AI can do on it.' },
        clients: { title: 'Connect an AI app', description: 'Use the same secure MCP connection in the assistant you prefer.' },
        audit: { title: 'Activity', description: 'Review actions requested through your connected devices.' },
        usage: { title: 'Usage & Users', description: 'Owner-only activity and account statistics for this Cloud service.' },
      }[activeTab] || { title: 'Your devices', description: '' };
      const navItem = (tab, icon, title) => \`
        <button type="button" data-dashboard-tab="\${tab}" aria-current="\${activeTab === tab ? 'page' : 'false'}"
          class="workspace-nav-item \${activeTab === tab ? 'active' : ''}" onclick="switchTab('\${tab}')">
          <span class="workspace-nav-icon" aria-hidden="true">\${icon}</span><span>\${title}</span>
        </button>\`;
      const online = devicesList.filter(d => d.isLiveConnected).length;
      const total = devicesList.length;
      root.innerHTML = \`
        <div class="workspace-shell">
          <aside class="workspace-sidebar">
            <a href="/dashboard" class="sidebar-brand" aria-label="SSH MCP Pro workspace">
              <img src="/brand/ssh-mcp-pro-icon.png" alt="SSH MCP Pro" width="46" height="46" class="brand-mark">
              <span><strong>SSH MCP Pro</strong><small>Cloud workspace</small></span>
            </a>
            <p class="sidebar-label">WORKSPACE</p>
            <nav class="workspace-nav" aria-label="Workspace navigation">
              \${navItem('devices', '▤', 'Devices')}
              \${navItem('add-device', '+', 'Add a device')}
              \${navItem('clients', '✦', 'AI connections')}
              \${navItem('audit', '◷', 'Activity')}
              \${currentUser.serviceOwner ? navItem('usage', '▥', 'Usage & Users') : ''}
            </nav>
            <div class="sidebar-bottom">
              <div class="sidebar-help"><span class="live-indicator" aria-hidden="true"></span><span>Cloud connection active</span></div>
              <div class="sidebar-account">
                <span class="account-avatar" aria-hidden="true">\${escapeHtml((currentUser.displayName || currentUser.id || 'S').slice(0, 1).toUpperCase())}</span>
                <span class="sidebar-account-text"><strong>\${escapeHtml(currentUser.displayName || 'Signed in')}</strong><small>\${escapeHtml(currentUser.provider === 'github' ? 'GitHub account' : 'Google account')}</small></span>
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
              <div><p class="eyebrow">MANAGE YOUR CONNECTION</p><h1>\${escapeHtml(pageMeta.title)}</h1><p>\${escapeHtml(pageMeta.description)}</p></div>
              \${activeTab !== 'add-device' ? '<button class="btn btn-primary" type="button" onclick="switchTab(\\'add-device\\')"><span aria-hidden="true">+</span> Add a device</button>' : '<button class="btn btn-outline" type="button" onclick="switchTab(\\'devices\\')">Back to devices</button>'}
            </div>
            \${activeTab === 'devices' ? \`
              <section class="connection-summary" aria-label="Connection overview">
                <div class="connection-summary-primary"><span class="summary-pulse" aria-hidden="true"></span><div>
                  <strong>\${!devicesLoaded ? 'Checking your devices…' : online > 0 ? "You're ready to work" : total > 0 ? 'Your devices are offline' : 'Connect your first device'}</strong>
                  <span>\${!devicesLoaded ? 'Loading live connection status' : online > 0 ? online + ' connected device' + (online === 1 ? '' : 's') + ' · Connect an AI app to start' : total > 0 ? 'Check the agent on your computer to reconnect' : 'Your AI assistant needs a connected computer to get started'}</span>
                </div></div>
                <button class="btn btn-soft" type="button" onclick="switchTab('\${total > 0 ? 'clients' : 'add-device'}')">\${total > 0 ? 'Connect an AI app' : 'Connect a device'} <span aria-hidden="true">→</span></button>
              </section>
              \${!devicesLoaded ? '' : total > 0 ? '<p class="device-scope-note" role="note">Showing devices for your ' + escapeHtml(currentUser.provider === 'github' ? 'GitHub' : 'Google') + ' account. Other sign-in providers have separate device lists.</p>' : ''}
            \` : ''}
            <div id="tabContent">\${renderTabContent()}</div>
          </main>
        </div>
      \`;
      if (activeTab === 'devices' && !devicesLoaded) loadDevices();
      if (activeTab === 'add-device') chooseInstallOS(selectedInstallOs);
      if (activeTab === 'audit') loadAudit();
      if (activeTab === 'usage' && currentUser.serviceOwner) loadUsage();
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
      if (tab === 'devices' && activeTab !== tab) devicesLoaded = false;
      activeTab = tab;
      renderApp();
      document.querySelector('[data-dashboard-tab="' + tab + '"]')?.focus({ preventScroll: true });
    }

    function renderLanding() {
      return \`
        <div class="landing-shell">
          <section class="landing-hero">
            <div class="landing-copy">
              <div class="eyebrow"><span class="mini-spark" aria-hidden="true"></span> YOUR OWN MACHINES · ANY AI ASSISTANT</div>
              <h1>Connect your computers to <em>ChatGPT, Claude & Gemini.</em></h1>
              <p>Use AI with the computers and servers you already own. Sign in, connect a device, and choose what your assistant is allowed to access.</p>
              <div class="auth-buttons">
                <a href="/auth/login/google" class="auth-btn auth-btn-google">
                  <span class="google-icon" aria-hidden="true">G</span> Continue with Google
                </a>
                <a href="/auth/login/github" class="auth-btn auth-btn-github">
                  <span class="github-icon" aria-hidden="true">⌘</span> Continue with GitHub
                </a>
              </div>
              <p class="landing-small-note">Already connected a device? Sign in with the same account to find it.</p>
              <p id="providerSetup" class="device-scope-note" role="status" hidden>Local sign-in is not configured yet. Configure a supported OAuth provider or use the <a href="https://ssh-mcp-pro.oaslananka.dev/">hosted dashboard</a>.</p>
            </div>
            <div class="landing-illustration" aria-label="How SSH MCP Pro connects an AI assistant to your own computer">
              <div class="flow-card flow-assistant"><span class="flow-overline">YOUR ASSISTANT</span><strong>ChatGPT <span>·</span> Claude <span>·</span> Gemini</strong><small>The AI app you prefer</small></div>
              <div class="flow-line"><span></span><div class="flow-flow-icon" aria-hidden="true">↓</div><span></span></div>
              <div class="flow-card flow-gateway"><img src="/brand/ssh-mcp-pro-icon.png" width="48" height="48" alt="" aria-hidden="true"><div><strong>SSH MCP Pro</strong><small>Permission-controlled connection</small></div></div>
              <div class="flow-line"><span></span><div class="flow-flow-icon" aria-hidden="true">↓</div><span></span></div>
              <div class="flow-card flow-computer"><span class="flow-computer-icon" aria-hidden="true">▣</span><div><strong>Your computer</strong><small>Your files, terminal and services stay on your machine</small></div></div>
              <div class="flow-caption"><span class="mini-spark" aria-hidden="true"></span> YOUR DEVICE · YOUR ACCESS RULES</div>
            </div>
          </section>
          <section class="onboarding-section" aria-labelledby="start-heading">
            <div class="onboarding-section-head"><p class="eyebrow">GET STARTED</p><h2 id="start-heading">Three steps. You're in control.</h2><p>Go from your first sign-in to a working AI connection.</p></div>
            <div class="onboarding-steps">
              <article><span class="step-number">01</span><h3>Sign in</h3><p>Use Google or GitHub to create your private workspace.</p></article>
              <article><span class="step-number">02</span><h3>Connect a device</h3><p>Install the lightweight agent on your computer or server. You choose its permissions.</p></article>
              <article><span class="step-number">03</span><h3>Connect an AI app</h3><p>Use the secure MCP endpoint from ChatGPT, Claude or Gemini and start working.</p></article>
            </div>
          </section>
          <section class="landing-local"><div><span class="landing-local-symbol" aria-hidden="true">⌘</span><div><h2>Prefer to stay local?</h2><p>Run SSH MCP Pro with your own SSH configuration. No Cloud account required.</p></div></div><code>npx ssh-mcp-pro</code></section>
        </div>
      \`;
    }

    function renderTabContent() {
      if (activeTab === 'usage' && currentUser.serviceOwner) return renderUsagePanel();

      if (activeTab === 'devices') {
        if (!devicesLoaded) {
          return '<div class="card device-loading" role="status">Loading your connected devices…</div>';
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
                  <div class="device-meta">\${escapeHtml(dev.host_metadata?.os || dev.host_metadata?.platform || 'Computer')} · \${escapeHtml(dev.host_metadata?.hostname || 'Device')} · \${escapeHtml(dev.profile)}</div></div>
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
              \${!dev.isLiveConnected && dev.status !== 'revoked' ? '<div class="device-offline-tip">Agent offline — start SSH MCP Pro Agent on this computer to reconnect. <a href="https://github.com/oaslananka/ssh-mcp-pro/blob/main/docs/adding-a-device.md" target="_blank" rel="noopener noreferrer">Connection help</a></div>' : ''}
            </article>
          \`).join('')}
          </div>
        </section>\`;
      }

      if (activeTab === 'add-device') {
        return \`
          <section class="setup-intro">
            <p class="eyebrow">DEVICE SETUP</p>
            <h2>Set up your computer in three steps</h2>
            <p>Choose the computer you want to connect, start its agent, then confirm it is online.</p>
            <div class="setup-steps" aria-label="Setup stages">
              <span><strong>01</strong> Choose access</span>
              <span><strong>02</strong> Run setup</span>
              <span><strong>03</strong> Confirm online</span>
            </div>
          </section>

          <div class="card">
            <h2 style="margin-bottom:12px;">Connect a new computer</h2>
            <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">\${localBrowserLink ? 'Approve the local agent waiting in your terminal. The one-time credential stays inside your browser and device; do not copy it into chat.' : 'Choose a name and access level. Setup commands are provided for your computer.'}</p>
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
              <h3 style="margin-bottom:8px;">Linux / WSL: Set up with your browser</h3>
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

      if (activeTab === 'audit') {
        if (auditList.length === 0) {
          return '<div class="card empty-box">No audit events recorded yet.</div>';
        }
        return \`
          <div class="card" style="padding:0; overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
              <thead style="background:#21262d; border-bottom:1px solid var(--card-border);">
                <tr>
                  <th style="padding:12px 16px;">Timestamp</th>
                  <th style="padding:12px 16px;">Event</th>
                  <th style="padding:12px 16px;">Severity</th>
                  <th style="padding:12px 16px;">Target</th>
                </tr>
              </thead>
              <tbody>
                \${auditList.map(e => \`
                  <tr style="border-bottom:1px solid #21262d;">
                    <td style="padding:12px 16px; font-family:var(--font-mono); color:var(--text-muted);">\${new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td style="padding:12px 16px; font-weight:600;">\${escapeHtml(e.eventType)}</td>
                    <td style="padding:12px 16px;"><span class="badge \${e.severity === 'info' ? 'badge-blue' : (e.severity === 'warn' ? 'badge-green' : 'badge-gray')}">\${e.severity}</span></td>
                    <td style="padding:12px 16px; font-family:var(--font-mono); color:var(--text-muted);">\${escapeHtml(e.agentAlias || e.agentId || e.actionId || '-')}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      }
    }

    function renderUsagePanel() {
      if (!usageData) return '<div class="card" role="status">Loading service usage…</div>';
      const n = value => new Intl.NumberFormat('en-US').format(Number(value || 0));
      const metrics = [
        ['Registered accounts', usageData.registeredUsers, 'Accounts are not unique people'],
        ['Enrolled devices', usageData.registeredAgents, 'Online and offline agents'],
        ['Tool calls · 7 days', usageData.actionsLast7Days, 'Recorded agent actions'],
        ['Tool calls · all time', usageData.totalActions, 'Not OAuth clients or login events']
      ];
      return '<section class="usage-head"><div><div class="eyebrow">Owner workspace</div><h2>Service overview</h2><p>Live, read-only service statistics. Account totals do not imply unique individuals.</p></div><button class="btn btn-outline" onclick="loadUsage()">Refresh statistics</button></section>' +
        '<div class="usage-grid">' + metrics.map(item => '<div class="usage-stat"><div class="stat-label">' + escapeHtml(item[0]) + '</div><strong>' + n(item[1]) + '</strong><small>' + escapeHtml(item[2]) + '</small></div>').join('') + '</div>' +
        '<section class="card"><h3>Registered accounts</h3><p class="device-scope-note">Visible only to explicitly configured service owners. AI providers and OAuth clients are not additional users.</p><div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Account</th><th>Provider</th><th>Devices</th><th>Tool calls</th><th>Last action</th></tr></thead><tbody>' +
        usageData.accounts.map(a => '<tr><td>' + escapeHtml(a.label || 'Account') + '</td><td>' + escapeHtml(a.provider) + '</td><td>' + n(a.agents) + '</td><td>' + n(a.actions) + '</td><td>' + escapeHtml(a.lastActionAt ? new Date(a.lastActionAt).toLocaleString() : 'No actions') + '</td></tr>').join('') +
        '</tbody></table></div></section>';
    }

    async function loadUsage() {
      const target = document.getElementById('tabContent');
      try {
        const response = await fetch('/api/dashboard/usage', { cache: 'no-store' });
        if (!response.ok) throw new Error('Usage data unavailable or access denied');
        usageData = await response.json();
        if (activeTab === 'usage' && target) target.innerHTML = renderUsagePanel();
      } catch (error) {
        if (activeTab === 'usage' && target) target.innerHTML = '<div class="card" role="alert">Could not load usage. Check owner authorization and retry.</div>';
      }
    }

    async function loadDevices() {
      try {
        const res = await fetch('/api/dashboard/devices');
        if (res.ok) {
          const data = await res.json();
          devicesList = data.devices || [];
          devicesLoaded = true;
          if (activeTab === 'devices') renderApp();
        }
      } catch (e) {
        console.error('Failed to load devices', e);
      }
    }

    async function loadAudit() {
      try {
        const res = await fetch('/api/dashboard/audit');
        if (res.ok) {
          const data = await res.json();
          auditList = data.events || [];
          const tabContent = document.getElementById('tabContent');
          if (activeTab === 'audit' && tabContent) {
            tabContent.innerHTML = renderTabContent();
          }
        }
      } catch (e) {
        console.error('Failed to load audit events', e);
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
  <footer class="site-footer"><span>SSH MCP Pro · Designed for controlled remote operations</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="https://github.com/oaslananka/ssh-mcp-pro/issues" rel="noopener noreferrer">Support</a></span></footer>
</body>
</html>`;
}
