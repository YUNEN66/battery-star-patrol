const $ = (selector) => document.querySelector(selector);
const MANUAL_STORAGE_KEY = "battery-star-patrol.manual-capacity.v1";
let installPrompt = null;
let nativeSnapshot = null;
let manualSnapshot = readManualCapacity();

if (manualSnapshot) {
  $("#manual-full").value = manualSnapshot.full;
  $("#manual-design").value = manualSnapshot.design;
  $("#manual-message").textContent = "已载入此浏览器中保存的手动容量。";
}

function readManualCapacity() {
  try {
    const stored = JSON.parse(localStorage.getItem(MANUAL_STORAGE_KEY) || "null");
    if (stored && Number.isFinite(stored.full) && Number.isFinite(stored.design) && stored.full > 0 && stored.design > 0) {
      return stored;
    }
  } catch {
    // Local storage can be disabled or contain an old, invalid value.
  }
  return null;
}

function formatCapacity(capacity, source) {
  if (!Number.isFinite(capacity) || capacity <= 0) return "--";
  return source === "windows"
    ? `${(capacity / 1000).toFixed(1)}<span class="unit"> Wh</span>`
    : `${Math.round(capacity).toLocaleString("zh-CN")}<span class="unit"> mAh</span>`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function setBadge(text, tone = "neutral") {
  const badge = $("#status-badge");
  badge.className = `status-badge ${tone}`;
  badge.textContent = text;
}

function showUnavailable(title, message) {
  $("#unavailable-panel").hidden = false;
  $("#unavailable-title").textContent = title;
  $("#unavailable-message").textContent = message;
  $("#health-card").classList.add("health-unavailable");
  $("#health-value").innerHTML = `<span>未开放</span>`;
  $("#health-caption").textContent = "系统没有提供健康度数据";
  $("#health-source").textContent = "不以当前电量推算电池健康度";
  $("#health-rule-fill").style.width = "0";
  $("#full-capacity").textContent = "暂不可读";
  $("#design-capacity").textContent = "暂不可读";
  $("#cycle-count").textContent = "暂不可读";
  $("#full-capacity-note").textContent = "需设备系统或厂商开放";
  $("#design-capacity-note").textContent = "需设备系统或厂商开放";
  $("#cycle-note").textContent = "不同机型开放的数据不同";
}

function renderHealth(full, design, source, cycleCount = null) {
  const rawHealth = (full / design) * 100;
  const health = Math.min(rawHealth, 100);
  const display = `${health.toFixed(1)}<span>%</span>`;
  $("#health-value").innerHTML = display;
  $("#full-capacity").innerHTML = formatCapacity(full, source);
  $("#design-capacity").innerHTML = formatCapacity(design, source);
  $("#cycle-count").textContent = Number.isInteger(cycleCount) && cycleCount >= 0 ? `${cycleCount} 次` : "暂不可读";
  $("#full-capacity-note").textContent = "完整充电后可用的容量";
  $("#design-capacity-note").textContent = "电池出厂时的额定容量";
  $("#cycle-note").textContent = Number.isInteger(cycleCount) && cycleCount >= 0
    ? "完整循环一次约等于累计用完 100% 电量"
    : "电池固件没有提供循环次数";
  $("#health-source").textContent = source === "windows"
    ? "来源：Windows 电池报告 · 最近一次读取"
    : "来源：手动输入容量 · 仅供参考";
  $("#health-card .live-pill").textContent = source === "windows" ? "系统数据" : "手动估算";
  $("#health-caption").textContent = rawHealth > 100
    ? "满充容量略高于标称值；按 100% 展示，不代表电池超过新电池状态。"
    : health >= 90
      ? "状态良好，容量仍接近初始设计值"
      : health >= 80
        ? "状态尚可，留意续航变化"
        : health >= 60
          ? "容量已有明显衰减，可留意是否影响使用"
          : "容量明显衰减，建议联系厂商检查";
  $("#health-rule-fill").style.width = `${Math.max(3, Math.min(health, 100))}%`;
  $("#unavailable-panel").hidden = true;
  $("#health-card").classList.remove("health-unavailable");
}

function renderCharge(percent, charging) {
  if (Number.isFinite(percent)) {
    const rounded = Math.round(Math.max(0, Math.min(100, percent)));
    $("#charge-value").textContent = rounded;
    $("#charge-meter").style.width = `${rounded}%`;
    $("#charge-caption").textContent = charging ? "CHARGING / 正在充电" : "BATTERY / 当前电量";
  } else {
    $("#charge-value").textContent = "--";
    $("#charge-meter").style.width = "0%";
    $("#charge-caption").textContent = "CHARGE / 暂不可读";
  }
}

function renderDevice(snapshot) {
  const hasBattery = snapshot.batteryPresent === true;
  const noBattery = snapshot.batteryPresent === false;
  const device = hasBattery ? "检测到系统电池" : noBattery ? "当前设备没有可读取的电池" : "系统未开放电池设备信息";
  $("#device-description").textContent = snapshot.deviceName
    ? `${snapshot.deviceName} · ${device}`
    : device;
  $("#cell-code").textContent = hasBattery ? "ONLINE" : noBattery ? "NO CELL" : "UNKNOWN";
  $("#connection-label").innerHTML = hasBattery
    ? `<span class="signal-dot"></span>${snapshot.source === "windows" ? "已连接 Windows 系统电池" : "已连接设备电池"}`
    : noBattery
      ? `<span class="signal-dot" style="background:var(--pink);box-shadow:none"></span>未检测到系统电池`
      : `<span class="signal-dot" style="background:var(--pink);box-shadow:none"></span>系统未开放电池接口`;
  $("#hero-description").textContent = hasBattery
    ? (snapshot.source === "windows"
      ? "读取本机最近一次 Windows 电池报告。健康度由满充容量与设计容量估算。"
      : "设备已开放当前电量信息；电池健康度仍需系统或厂商单独开放。")
    : noBattery
      ? "这台设备暂时没有系统电池，电池健康度和容量不适用。"
      : "当前系统没有开放足够的电池信息；未开放的数据不会由当前电量推算。";
  renderCharge(snapshot.chargePercent, snapshot.charging);
  $("#updated-at").textContent = formatTime(new Date());
  if (snapshot.source === "windows") {
    $("#source-explainer").textContent = "Windows 电池报告会提供设计容量和最近满充容量。固件报告可能有误差，数据只在本机读取。";
    $("#connection-label").title = "温度仅在系统可靠提供时显示。";
  } else {
    $("#source-explainer").textContent = "Android 公共接口通常只开放当前电量和充电状态，不通用开放设计容量、满充容量或循环次数。";
  }

  if (snapshot.designCapacityMWh > 0 && snapshot.fullChargeCapacityMWh > 0) {
    renderHealth(snapshot.fullChargeCapacityMWh, snapshot.designCapacityMWh, "windows", snapshot.cycleCount);
    setBadge("系统容量数据已读取", "good");
  } else if (manualSnapshot) {
    renderHealth(manualSnapshot.full, manualSnapshot.design, "manual");
    setBadge("使用本机保存的手动估算", "manual");
    $("#unavailable-panel").hidden = false;
    $("#unavailable-title").textContent = "系统没有开放容量数据";
    $("#unavailable-message").textContent = "下方读数来自你手动输入的容量，仅供参考；系统健康度仍暂不可读。";
  } else {
    showUnavailable(
      noBattery ? "这台设备没有可读取的电池" : "系统暂未开放电池健康度",
      snapshot.message || (hasBattery
        ? "系统只开放了当前电量，没有提供健康度或容量信息。此处不会猜测或生成数据。"
        : noBattery
          ? "台式机或不含系统电池的设备无法查看电池健康度；手动记录仍可在有电池的设备上使用。"
          : "系统没有开放足够的电池信息。此处不会猜测或生成数据。")
    );
    setBadge(noBattery ? "未检测到电池" : "健康度暂不可读", "neutral");
  }
}

async function loadWindowsSnapshot() {
  try {
    const response = await fetch("/api/battery", { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (payload.app !== "battery-star-patrol") throw new Error("本机电池服务身份不匹配");
    if (!response.ok) {
      $("#unavailable-panel").hidden = false;
      $("#unavailable-title").textContent = "Windows 电池报告读取失败";
      $("#unavailable-message").textContent = payload.message || `本机服务返回错误（${response.status}）。请重新打开应用或检查电池驱动。`;
      setBadge("读取失败，请重试", "neutral");
      $("#connection-label").innerHTML = `<span class="signal-dot" style="background:var(--pink);box-shadow:none"></span>Windows 电池报告暂不可用`;
      return true;
    }
    nativeSnapshot = payload;
    renderDevice(payload);
    return true;
  } catch {
    return false;
  }
}

async function loadPlatformBattery() {
  if ("getBattery" in navigator) {
    try {
      const battery = await navigator.getBattery();
      const render = () => {
        if (nativeSnapshot) return;
        const chargePercent = Number.isFinite(battery.level) ? battery.level * 100 : null;
        const snapshot = {
          source: "browser",
          batteryPresent: null,
          chargePercent,
          charging: battery.charging,
          deviceName: "",
          message: "浏览器只开放当前电量与充电状态，通常不开放电池健康度。"
        };
        renderDevice(snapshot);
        setBadge("只显示系统开放的数据", "neutral");
        $("#connection-label").innerHTML = `<span class="signal-dot"></span>已连接浏览器电池接口`;
      };
      render();
      battery.addEventListener("levelchange", render);
      battery.addEventListener("chargingchange", render);
      return;
    } catch {
      // Some browser builds expose the API but block its battery permission.
    }
  }

  if (!nativeSnapshot) {
    const snapshot = {
      source: "browser",
      batteryPresent: null,
      chargePercent: null,
      charging: false,
      deviceName: "",
      message: "当前浏览器没有开放电池信息。Android 上可查看系统设置；电池健康度不会由当前电量推算。"
    };
    renderDevice(snapshot);
    $("#connection-label").innerHTML = `<span class="signal-dot" style="background:var(--pink);box-shadow:none"></span>浏览器未开放电池接口`;
    setBadge("系统健康度未开放", "neutral");
  }
}

$("#manual-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const full = Number($("#manual-full").value);
  const design = Number($("#manual-design").value);
  if (!Number.isFinite(full) || !Number.isFinite(design) || full <= 0 || design <= 0) {
    $("#manual-message").textContent = "请输入大于 0 的有效容量。";
    return;
  }
  if (full > 200000 || design > 200000) {
    $("#manual-message").textContent = "容量超出支持范围，请检查输入单位是否为 mAh。";
    return;
  }
  const updatedSnapshot = { full, design };
  try {
    localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(updatedSnapshot));
  } catch {
    $("#manual-message").textContent = "浏览器未允许本地保存；请检查隐私设置后重试。";
    return;
  }
  manualSnapshot = updatedSnapshot;
  if (!nativeSnapshot?.designCapacityMWh || !nativeSnapshot?.fullChargeCapacityMWh) {
    renderHealth(full, design, "manual");
    setBadge("已保存为手动估算", "manual");
    $("#unavailable-panel").hidden = false;
    $("#unavailable-title").textContent = "此读数来自手动输入";
    $("#unavailable-message").textContent = "系统没有开放容量数据；手动结果只用作估算，请勿当作系统实测。";
  }
  $("#manual-message").textContent = "已保存在此设备的浏览器中，不会上传。";
});

$("#clear-manual").addEventListener("click", () => {
  try {
    localStorage.removeItem(MANUAL_STORAGE_KEY);
    manualSnapshot = null;
    $("#manual-full").value = "";
    $("#manual-design").value = "";
    $("#manual-message").textContent = "本机保存的手动容量已清除。";
    if (nativeSnapshot) renderDevice(nativeSnapshot);
    else loadPlatformBattery();
  } catch {
    $("#manual-message").textContent = "浏览器未允许清除本地记录，请检查隐私设置。";
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#install-button").hidden = false;
});

$("#install-button").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $("#install-button").hidden = true;
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Offline caching is a convenience; the live app remains usable without it.
    });
  });
}

if (location.hostname === "127.0.0.1") {
  loadWindowsSnapshot().then((connected) => {
    if (!connected) loadPlatformBattery();
  });
} else {
  loadPlatformBattery();
}
