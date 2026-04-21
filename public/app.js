async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }
  return response.json();
}

function fmt(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function shortText(text, limit = 64) {
  const value = fmt(text);
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function setLastUpdated() {
  const label = document.getElementById("lastUpdated");
  label.textContent = `更新时间: ${new Date().toLocaleString()}`;
}

async function loadHealth() {
  const data = await fetchJson("/health");
  document.getElementById("healthBox").textContent = JSON.stringify(data, null, 2);
}

let currentAccount = null;

async function loadAccounts() {
  const data = await fetchJson("/accounts");
  const tabContainer = document.getElementById("accountTabsContainer");
  const pageContainer = document.getElementById("accountPagesContainer");

  tabContainer.innerHTML = '<button type="button" class="account-tab" data-account-id="setup">连接设置</button>';
  pageContainer.innerHTML = "";

  const setupTab = tabContainer.querySelector('[data-account-id="setup"]');
  setupTab.addEventListener("click", () => switchAccount("setup"));

  if (data.length === 0) {
    switchAccount("setup");
    return data;
  }

  for (const row of data) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "account-tab";
    tab.dataset.accountId = row.accountId;
    tab.innerHTML = `<strong>${fmt(row.accountId)}</strong><br><small>${row.connector}</small>`;
    if (!row.ready) {
      tab.classList.add("pending");
    }
    tab.addEventListener("click", () => switchAccount(row.accountId));
    tabContainer.appendChild(tab);

    const page = document.createElement("div");
    page.className = "account-page";
    page.dataset.accountId = row.accountId;
    page.style.display = "none";
    page.innerHTML = `<div class="account-details"></div>`;
    pageContainer.appendChild(page);
  }

  if (data.length > 0) {
    switchAccount(data[0].accountId);
  }

  return data;
}

async function renderAccountPage(accountId) {
  if (accountId === "setup") {
    renderSetupPage();
    return;
  }

  const accounts = await fetchJson("/accounts");
  const account = accounts.find((a) => a.accountId === accountId);

  if (!account) {
    return;
  }

  const page = document.querySelector(`.account-page[data-account-id="${accountId}"]`);
  if (!page) {
    return;
  }

  const details = page.querySelector(".account-details");
  if (!details) {
    return;
  }

  let html = `<div class="account-header">
    <div>
      <h3>${fmt(account.accountId)}</h3>
      <small style="color: var(--muted);">${account.connector === "cloud" ? "业务账户" : "个人账户"}</small>
    </div>
    <div style="display: flex; gap: 10px; align-items: center;">
      <span class="badge ${account.ready ? "ok" : "off"}">${account.ready ? "已连接" : "未连接"}</span>
      <button type="button" class="edit-account-btn" data-account-id="${accountId}" style="padding: 6px 12px; font-size: 0.85rem;">编辑</button>
      <button type="button" class="delete-account-btn" data-account-id="${accountId}" style="padding: 6px 12px; font-size: 0.85rem; background: #d9534f; color: white; border: none; border-radius: 6px; cursor: pointer;">删除</button>
    </div>
  </div>`;

  if (account.connector === "personal") {
    html += `
      <article class="card">
        <h3>个人WhatsApp二维码</h3>
        <div class="toolbar">
          <button type="button" class="qr-load-btn" data-account-id="${accountId}">加载二维码</button>
        </div>
        <div class="qr-hint-${accountId} hint">点击"加载二维码"来显示连接代码。</div>
        <div class="qr-box-${accountId} qr-box"></div>
      </article>
    `;
  } else if (account.connector === "cloud") {
    html += `
      <article class="card">
        <h3>业务API设置</h3>
        <div class="api-info">
          <p><strong>电话号码ID:</strong> ${fmt(account.phoneNumberId || "未设置")}</p>
          <p><strong>状态:</strong> ${account.ready ? "已连接" : "未连接"}</p>
        </div>
      </article>
    `;
  }

  html += `
    <article class="card">
      <h3>发送消息</h3>
      <form class="send-form" data-account-id="${accountId}">
        <label>
          收件人: <input type="text" placeholder="852XXXXXXXX" required />
        </label>
        <label class="full">
          内容: <textarea rows="3" required></textarea>
        </label>
        <button type="submit">发送</button>
      </form>
      <pre class="send-result"></pre>
    </article>
  `;

  details.innerHTML = html;

  const editBtn = details.querySelector(".edit-account-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => editAccount(accountId));
  }

  const deleteBtn = details.querySelector(".delete-account-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => deleteAccount(accountId));
  }

  const qrBtn = details.querySelector(".qr-load-btn");
  if (qrBtn) {
    qrBtn.addEventListener("click", () => loadPersonalQr(accountId));
  }

  const sendForm = details.querySelector(".send-form");
  if (sendForm) {
    sendForm.addEventListener("submit", (e) => handleAccountSend(e, accountId));
  }

  await loadAccountMessages(accountId);
}

async function loadPersonalQr(accountId) {
  const hint = document.querySelector(`.qr-hint-${accountId}`);
  const qrBox = document.querySelector(`.qr-box-${accountId}`);

  try {
    const status = await fetchJson(`/accounts/personal/${encodeURIComponent(accountId)}/qr`);

    if (status.ready) {
      hint.textContent = `账户 ${accountId} 已连接。`;
      qrBox.innerHTML = "";
      return;
    }

    if (status.qrDataUrl) {
      hint.textContent = "用你的手机扫描这个二维码。";
      qrBox.innerHTML = `<img src="${status.qrDataUrl}" alt="WhatsApp QR code" />`;
      return;
    }

    hint.textContent = "二维码还没准备好。请等几秒钟后重试。";
    qrBox.innerHTML = "";
  } catch (error) {
    hint.textContent = `错误: ${error.message}`;
    qrBox.innerHTML = "";
  }
}

async function editAccount(accountId) {
  const accounts = await fetchJson("/accounts");
  const account = accounts.find((a) => a.accountId === accountId);

  if (!account) {
    alert("账户未找到");
    return;
  }

  if (account.connector === "cloud") {
    const cloudAccounts = await fetchJson("/settings/cloud-accounts");
    const cloudAccount = cloudAccounts.find((a) => a.accountId === accountId);

    if (!cloudAccount) {
      alert("无法找到账户详情");
      return;
    }

    const newPhoneNumberId = prompt("电话号码ID:", cloudAccount.phoneNumberId);
    if (newPhoneNumberId === null) return;

    const newAccessToken = prompt("访问令牌:", "");
    if (newAccessToken === null) return;

    const newVerifyToken = prompt("验证令牌:", "");
    if (newVerifyToken === null) return;

    try {
      await fetchJson("/settings/cloud-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          displayName: cloudAccount.displayName || null,
          phoneNumberId: newPhoneNumberId,
          accessToken: newAccessToken || cloudAccount.accessToken,
          verifyToken: newVerifyToken || cloudAccount.verifyToken
        })
      });
      alert("账户已更新");
      await loadAccounts();
    } catch (error) {
      alert("更新失败: " + error.message);
    }
  }
}

async function deleteAccount(accountId) {
  if (!confirm(`确定要删除账户 "${accountId}" 吗？此操作无法撤销。`)) {
    return;
  }

  try {
    await fetchJson(`/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE"
    });

    alert("账户已删除");
    await loadAccounts();
  } catch (error) {
    alert("删除失败: " + error.message);
  }
}

async function loadAccountMessages(accountId) {
  const page = document.querySelector(`.account-page[data-account-id="${accountId}"]`);
  if (!page) return;

  let messageHtml = page.querySelector(".account-messages")?.outerHTML || "";
  if (!messageHtml) {
    messageHtml = `
      <article class="card">
        <h3>Messages</h3>
        <div class="table-wrap">
          <table class="account-message-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Direction</th>
                <th>From</th>
                <th>To</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </article>
    `;
    page.querySelector(".account-details").insertAdjacentHTML("beforeend", messageHtml);
  }

  const messages = await fetchJson(`/messages?limit=50&accountId=${encodeURIComponent(accountId)}`);
  const tbody = page.querySelector(".account-message-table tbody");
  tbody.innerHTML = "";

  for (const msg of messages) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmt(msg.createdAt)}</td>
      <td>${fmt(msg.direction)}</td>
      <td>${fmt(msg.fromNumber)}</td>
      <td>${fmt(msg.toNumber)}</td>
      <td>${shortText(msg.text)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function handleAccountSend(event, accountId) {
  event.preventDefault();
  const form = event.target;
  const to = form.querySelector("input[type='text']").value.trim();
  const text = form.querySelector("textarea").value.trim();
  const resultBox = form.querySelector(".send-result");

  const accounts = await fetchJson("/accounts");
  const account = accounts.find((a) => a.accountId === accountId);

  if (!account) {
    resultBox.textContent = "账户未找到";
    return;
  }

  try {
    const data = await fetchJson("/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connector: account.connector === "cloud" ? "cloud" : "personal",
        accountId,
        to,
        text
      })
    });
    resultBox.textContent = JSON.stringify(data, null, 2);
    await loadAccountMessages(accountId);
  } catch (error) {
    resultBox.textContent = `错误: ${error.message}`;
  }
}

function renderSetupPage() {
  const pageContainer = document.getElementById("accountPagesContainer");
  const existingSetup = pageContainer.querySelector("[data-account-id='setup']");
  if (existingSetup) {
    existingSetup.remove();
  }

  const setupPage = document.createElement("div");
  setupPage.className = "account-page";
  setupPage.dataset.accountId = "setup";
  setupPage.style.display = "none";
  setupPage.innerHTML = `
    <div class="account-details">
      <h3>连接设置</h3>
      <div class="connection-selector">
        <h4>选择连接类型</h4>
        <div class="toggle-group">
          <button type="button" class="toggle-btn active" data-type="personal">个人WhatsApp (二维码)</button>
          <button type="button" class="toggle-btn" data-type="business">业务WhatsApp (API)</button>
        </div>
      </div>

      <div id="setupPersonalSection">
        <article class="card">
          <h4>个人WhatsApp二维码</h4>
          <p>个人连接使用固定账户 personal-default。请先设置 WA_PERSONAL_SESSION_DIR，然后重启服务并在账户页加载二维码。</p>
        </article>
      </div>

      <div id="setupBusinessSection" style="display: none;">
        <article class="card">
          <h4>业务WhatsApp API</h4>
          <form id="setupBusinessForm" class="form-grid">
            <label>
              显示名称
              <input type="text" id="setupCloudDisplayName" placeholder="香港WhatsApp业务" />
            </label>
            <label>
              电话号码ID
              <input type="text" id="setupCloudPhoneNumberId" required />
            </label>
            <label class="full">
              访问令牌
              <input type="text" id="setupCloudAccessToken" required />
            </label>
            <label class="full">
              验证令牌
              <input type="text" id="setupCloudVerifyToken" required />
            </label>
            <button type="submit">保存业务账户</button>
          </form>
          <p class="hint">保存后会覆盖当前唯一 cloud 账户（cloud-default）。</p>
          <pre id="setupCloudResult"></pre>
        </article>
      </div>
    </div>
  `;
  pageContainer.appendChild(setupPage);

  const setupToggleBtns = setupPage.querySelectorAll(".toggle-btn");
  const setupPersonalSection = setupPage.querySelector("#setupPersonalSection");
  const setupBusinessSection = setupPage.querySelector("#setupBusinessSection");

  setupToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setupToggleBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (btn.dataset.type === "personal") {
        setupPersonalSection.style.display = "";
        setupBusinessSection.style.display = "none";
      } else {
        setupPersonalSection.style.display = "none";
        setupBusinessSection.style.display = "";
      }
    });
  });

  setupPage.querySelector("#setupBusinessForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultBox = setupPage.querySelector("#setupCloudResult");

    try {
      const data = await fetchJson("/settings/cloud-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: setupPage.querySelector("#setupCloudDisplayName").value.trim() || null,
          phoneNumberId: setupPage.querySelector("#setupCloudPhoneNumberId").value.trim(),
          accessToken: setupPage.querySelector("#setupCloudAccessToken").value.trim(),
          verifyToken: setupPage.querySelector("#setupCloudVerifyToken").value.trim()
        })
      });

      resultBox.textContent = "账户已保存！正在重新加载账户...";
      await loadAccounts();
    } catch (error) {
      resultBox.textContent = `错误: ${error.message}`;
    }
  });
}

function switchAccount(accountId) {
  currentAccount = accountId;

  document.querySelectorAll(".account-tab").forEach((tab) => {
    tab.classList.remove("active");
  });
  document.querySelector(`.account-tab[data-account-id="${accountId}"]`)?.classList.add("active");

  document.querySelectorAll(".account-page").forEach((page) => {
    page.style.display = "none";
  });

  if (accountId === "setup") {
    renderSetupPage();
    const setupPage = document.querySelector('.account-page[data-account-id="setup"]');
    if (setupPage) {
      setupPage.style.display = "";
    }
    return;
  }

  const targetPage = document.querySelector(`.account-page[data-account-id="${accountId}"]`);
  if (targetPage) {
    targetPage.style.display = "";
    renderAccountPage(accountId).catch(console.error);
  }
}
async function refreshAll() {
  await loadHealth();
  await loadAccounts();
  setLastUpdated();
}

document.getElementById("refreshAllBtn").addEventListener("click", () => {
  refreshAll().catch((error) => {
    console.error(error);
  });
});

refreshAll().catch((error) => {
  console.error(error);
  document.getElementById("healthBox").textContent = `加载失败: ${error.message}`;
});
