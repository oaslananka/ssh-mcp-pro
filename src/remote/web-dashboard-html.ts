import { DASHBOARD_STYLES } from "./web-dashboard-styles.js";
export function renderDashboardHtml(
  initialUserBase64: string,
  mcpUrlJson: string,
  publicUrlJson: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ssh-mcp-pro | Secure SSH MCP Platform</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${DASHBOARD_STYLES}</style>
</head>
<body>
  <header>
    <div class="logo-area">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="brand-title">ssh-mcp-pro</div>
        <div class="brand-sub">Model Context Protocol SSH Gateway</div>
      </div>
    </div>
    <div class="user-area" id="headerUserArea"></div>
  </header>

  <div class="container" id="appRoot">
    <!-- Rendered by client script based on currentUser -->
  </div>

  <script>
    const INITIAL_USER = JSON.parse(atob("${initialUserBase64}"));
    const MCP_URL = ${mcpUrlJson};
    const PUBLIC_URL = ${publicUrlJson};

    let currentUser = INITIAL_USER;
    let activeTab = 'devices';
    let devicesList = [];
    let auditList = [];

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }

    function renderHeader() {
      const container = document.getElementById('headerUserArea');
      if (currentUser) {
        container.innerHTML = \`
          <span class="badge badge-green">Connected</span>
          <span style="font-size: 14px; font-weight: 600;">\${escapeHtml(currentUser.displayName || currentUser.id)}</span>
          <span class="badge badge-blue">\${escapeHtml(currentUser.provider)}</span>
          <a href="/auth/logout" class="btn btn-outline btn-sm">Sign out</a>
        \`;
      } else {
        container.innerHTML = \`
          <a href="/auth/login/google" class="btn btn-outline btn-sm">Sign In</a>
        \`;
      }
    }

    function renderApp() {
      const root = document.getElementById('appRoot');
      if (!currentUser) {
        root.innerHTML = renderLanding();
        return;
      }

      root.innerHTML = \`
        <div class="card" style="margin-bottom: 24px; background: linear-gradient(90deg, #161b22 0%, #1f242c 100%);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <div style="font-size:12px; text-transform:uppercase; font-weight:700; color:var(--blue); margin-bottom:4px;">Remote MCP Endpoint</div>
              <div style="font-family:var(--font-mono); font-size:15px; color:#fff; font-weight:600;">\${MCP_URL}</div>
              <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">Transport: Streamable HTTP • Auth: OAuth 2.1 PKCE (RFC 9728 & RFC 8414)</div>
            </div>
            <button class="btn btn-primary" onclick="switchTab('add-device')">➕ Add New Device</button>
          </div>
        </div>

        <nav class="tabs" aria-label="Dashboard sections">
          <button type="button" data-dashboard-tab="devices" aria-pressed="\${activeTab === 'devices'}" class="tab-item \${activeTab === 'devices' ? 'active' : ''}" onclick="switchTab('devices')">🖥️ Enrolled Devices</button>
          <button type="button" data-dashboard-tab="add-device" aria-pressed="\${activeTab === 'add-device'}" class="tab-item \${activeTab === 'add-device' ? 'active' : ''}" onclick="switchTab('add-device')">➕ Add Device</button>
          <button type="button" data-dashboard-tab="clients" aria-pressed="\${activeTab === 'clients'}" class="tab-item \${activeTab === 'clients' ? 'active' : ''}" onclick="switchTab('clients')">🤖 AI Integrations</button>
          <button type="button" data-dashboard-tab="audit" aria-pressed="\${activeTab === 'audit'}" class="tab-item \${activeTab === 'audit' ? 'active' : ''}" onclick="switchTab('audit')">📜 Audit Log</button>
        </nav>

        <div id="tabContent">
          \${renderTabContent()}
        </div>
      \`;

      if (activeTab === 'devices') loadDevices();
      if (activeTab === 'audit') loadAudit();
    }

    function switchTab(tab) {
      activeTab = tab;
      renderApp();
      document.querySelector('[data-dashboard-tab="' + tab + '"]')?.focus({ preventScroll: true });
    }

    function renderLanding() {
      return \`
        <div class="hero">
          <div style="font-size: 48px; margin-bottom: 12px;">🛡️⚡</div>
          <h1>ssh-mcp-pro Gateway</h1>
          <p>Zero-Trust Model Context Protocol SSH Gateway with policy controls, biometric & OAuth 2.1 authentication, and dual local/remote agent support.</p>
          <div class="auth-buttons">
            <a href="/auth/login/google" class="auth-btn auth-btn-google">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.7 0 3 .7 3.9 1.5l2.9-2.9C17 2 14.7 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.3 7.5 23.5 12 23.5z"/></svg>
              Sign in with Google
            </a>
            <a href="/auth/login/github" class="auth-btn auth-btn-github">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              Sign in with GitHub
            </a>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <h3 style="margin-bottom:8px; color:var(--blue);">🌐 Remote Streamable HTTP (OAuth 2.1)</h3>
            <p style="font-size:14px; color:var(--text-muted); margin-bottom:12px;">Connect supported MCP clients (ChatGPT plugins, Claude connectors, Gemini) through the HTTPS endpoint with OAuth policy enforcement.</p>
            <div class="code-box">\${MCP_URL}</div>
          </div>
          <div class="card">
            <h3 style="margin-bottom:8px; color:#7ee787;">💻 Local Stdio Mode (Unrestricted)</h3>
            <p style="font-size:14px; color:var(--text-muted); margin-bottom:12px;">No cloud dependencies, zero limits. Run ssh-mcp-pro locally with your own OpenSSH keys and config.</p>
            <div class="code-box">npx ssh-mcp-pro</div>
          </div>
        </div>
      \`;
    }

    function renderTabContent() {
      if (activeTab === 'devices') {
        if (devicesList.length === 0) {
          return \`
            <div class="card empty-box">
              <div style="font-size:40px; margin-bottom:12px;">🖥️</div>
              <h3 style="margin-bottom:8px;">No devices enrolled yet</h3>
              <p style="margin-bottom:20px;">Enroll your first server, VM, or local workstation to control it safely through MCP.</p>
              <button class="btn btn-primary" onclick="switchTab('add-device')">Enroll a Device</button>
            </div>
          \`;
        }
        return devicesList.map(dev => \`
          <div class="card">
            <div class="device-row">
              <div class="device-info">
                <div class="device-icon">\${dev.host_metadata?.platform === 'win32' ? '🪟' : (dev.host_metadata?.platform === 'darwin' ? '🍎' : '🐧')}</div>
                <div>
                  <div class="device-name">
                    \${escapeHtml(dev.alias)}
                    <span class="badge \${dev.isLiveConnected ? 'badge-green' : 'badge-gray'}">\${escapeHtml(dev.isLiveConnected ? '🟢 Live Online' : dev.status)}</span>
                    <span class="badge badge-blue">\${escapeHtml(dev.profile)}</span>
                  </div>
                  <div class="device-meta">
                    Host: \${escapeHtml(dev.host_metadata?.hostname || 'Not reported')} | OS: \${escapeHtml(dev.host_metadata?.os || 'Not reported')} | Arch: \${escapeHtml(dev.host_metadata?.arch || 'Not reported')} | Policy v\${escapeHtml(dev.policy_version ?? '—')}
                  </div>
                </div>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                <select aria-label="Policy for \${escapeHtml(dev.alias)}" class="btn btn-outline btn-sm" onchange="changePolicy('\${dev.id}', this.value)" \${dev.status === 'revoked' ? 'disabled' : ''}>
                  <option value="read-only" \${dev.profile === 'read-only' ? 'selected' : ''}>Profile: Read-Only</option>
                  <option value="operations" \${dev.profile === 'operations' ? 'selected' : ''}>Profile: Operations</option>
                  <option value="full-admin" \${dev.profile === 'full-admin' ? 'selected' : ''}>Profile: Full Admin</option>
                </select>
                <button class="btn btn-outline btn-sm" onclick="revokeDevice('\${dev.id}')" \${dev.status === 'revoked' ? 'disabled' : ''}>\${dev.status === 'revoked' ? 'Revoked' : 'Revoke access'}</button>
                <button class="btn btn-danger btn-sm" onclick="removeDevice('\${dev.id}')">Remove device</button>
              </div>
            </div>
          </div>
        \`).join('');
      }

      if (activeTab === 'add-device') {
        return \`
          <div class="card">
            <h2 style="margin-bottom:12px;">Enroll New Device</h2>
            <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">Generate an enrollment token and install the outbound agent on your target server.</p>
            <div style="display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap;">
              <div style="flex:1; min-width:240px;">
                <label for="enrollAlias" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Device Alias</label>
                <input id="enrollAlias" type="text" placeholder="e.g. production-bastion, home-server" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
              </div>
              <div style="flex:1; min-width:240px;">
                <label for="enrollProfile" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Initial Policy Profile</label>
                <select id="enrollProfile" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
                  <option value="read-only" selected>Read-Only (Status, Logs, Read Files)</option>
                  <option value="operations">Operations (Restart Services, Docker, Safe Shell)</option>
                  <option value="full-admin">Full Admin (Root sudo, File Write, Service Admin)</option>
                </select>
              </div>
            </div>
            <button class="btn btn-primary" onclick="generateEnrollment()">Generate Install Command</button>

            <div id="enrollOutput" style="margin-top:24px; display:none;">
              <h3 style="margin-bottom:12px; color:#fff;">One-Liner Installation Commands:</h3>

              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🐧 Linux (systemd)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdLinux')">Copy</button>
                  <span id="cmdLinux"></span>
                </div>
              </div>

              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🪟 Windows (PowerShell)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdWindows')">Copy</button>
                  <span id="cmdWindows"></span>
                </div>
              </div>

              <div>
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">📦 Node CLI (Linux/macOS)</div>
                <div class="code-box">
                  <button class="copy-btn" onclick="copySnippet('cmdNpm')">Copy</button>
                  <span id="cmdNpm"></span>
                </div>
              </div>
            </div>
          </div>
        \`;
      }

      if (activeTab === 'clients') {
        return \`
          <div class="grid-2">
            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">🤖</span>
                <h3>Claude Desktop & Claude Code</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">For remote access in Claude or Claude Desktop: <strong>Customize &gt; Connectors &gt; Add custom connector</strong>, enter this URL, then sign in. Local Desktop servers still use <code>claude_desktop_config.json</code>.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue);">Claude remote custom connector URL:</div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgClaudeRemote')">Copy</button><span id="cfgClaudeRemote">\${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Claude Code remote (run in a terminal):</div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgClaudeCode')">Copy</button><span id="cfgClaudeCode">claude mcp add --transport http ssh-mcp-pro \${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:#7ee787; margin-top:12px;">Claude Desktop local stdio:</div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgClaudeLocal')">Copy</button><span id="cfgClaudeLocal">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "command": "ssh-mcp-pro",\\n      "args": []\\n    }\\n  }\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💬</span>
                <h3>ChatGPT MCP Plugin</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">In supported ChatGPT workspaces, open <strong>Plugins &gt; Add custom MCP server</strong>, paste the URL below and configure OAuth. Custom GPT Actions are a separate OpenAPI-based feature.</p>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgChatGptMcp')">Copy</button><span id="cfgChatGptMcp">\${MCP_URL}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">✨</span>
                <h3>Gemini API (Interactions)</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Use this Remote MCP tool definition with the Gemini API Interactions endpoint. Configure a valid OAuth bearer credential separately (for example via managed agent credentials); the URL alone does not authenticate. This is not a Gemini web-extension manifest. <a href="https://ai.google.dev/gemini-api/docs/function-calling" target="_blank" rel="noopener noreferrer">Gemini Remote MCP docs</a>.</p>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgGemini')">Copy</button><span id="cfgGemini">{\\n  "type": "mcp_server",\\n  "name": "ssh_mcp_pro",\\n  "url": "\${MCP_URL}"\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💻</span>
                <h3>VS Code / Cursor / Windsurf</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Copy the configuration for your chosen client. VS Code/Copilot portable files use <code>mcpServers</code>; the VS Code workspace format uses <code>servers</code>. Sign in through your client&#39;s OAuth flow.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Copilot portable — <code>.mcp.json</code></div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgVsCodePortable')">Copy</button><span id="cfgVsCodePortable">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">VS Code workspace (compatible) — <code>.vscode/mcp.json</code></div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgVsCode')">Copy</button><span id="cfgVsCode">{\\n  "servers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Cursor — <code>.cursor/mcp.json</code></div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgCursor')">Copy</button><span id="cfgCursor">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Windsurf — <code>mcp_config.json</code></div>
              <div class="code-box"><button class="copy-btn" onclick="copySnippet('cfgWindsurf')">Copy</button><span id="cfgWindsurf">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "serverUrl": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
            </div>
          </div>
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
                    <td style="padding:12px 16px; font-family:var(--font-mono); color:var(--text-muted);">\${escapeHtml(e.agentId || e.actionId || '-')}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      }
    }

    async function loadDevices() {
      try {
        const res = await fetch('/api/dashboard/devices');
        if (res.ok) {
          const data = await res.json();
          devicesList = data.devices || [];
          const tabContent = document.getElementById('tabContent');
          if (activeTab === 'devices' && tabContent) {
            tabContent.innerHTML = renderTabContent();
          }
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

    async function generateEnrollment() {
      const alias = document.getElementById('enrollAlias').value.trim() || 'server-' + Math.floor(Math.random() * 1000);
      const profile = document.getElementById('enrollProfile').value;
      try {
        const res = await fetch('/api/dashboard/devices/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1' },
          body: JSON.stringify({ alias, requested_profile: profile })
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('cmdLinux').textContent = data.commands.linux;
          document.getElementById('cmdWindows').textContent = data.commands.windows;
          document.getElementById('cmdNpm').textContent = data.commands.npm;
          document.getElementById('enrollOutput').style.display = 'block';
        } else {
          alert('Failed to generate enrollment token.');
        }
      } catch (e) {
        alert('Error: ' + e.message);
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
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
      });
    }

    renderHeader();
    renderApp();
  </script>
</body>
</html>`;
}
