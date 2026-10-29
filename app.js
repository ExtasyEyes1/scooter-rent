// Самокат Рядом: scooter rental study demo.
// One ES module: data, pure helpers (pricing, sorting, storage parsing),
// a single app state and render functions that redraw the whole UI from that state.

/* ------------------------------------------------------------------ */
/* Data: the single source of truth                                    */
/* ------------------------------------------------------------------ */

export const TARIFFS = Object.freeze({
  standard: Object.freeze({ key: "standard", name: "Стандарт", label: "Поминутный", pricePerMinute: 6, startFee: 60 }),
});

export const NO_PACKAGE = "none";

// Prepaid minutes. The start is included; minutes beyond the package cost the standard rate.
export const PACKAGES = Object.freeze({
  p15: Object.freeze({ key: "p15", minutes: 15, price: 80, validDays: 1 }),
  p30: Object.freeze({ key: "p30", minutes: 30, price: 150, validDays: 1 }),
  p60: Object.freeze({ key: "p60", minutes: 60, price: 270, validDays: 7 }),
});

export const SUBSCRIPTION = Object.freeze({ name: "Плюс", discountPercent: 15, price: 0 });

// x / y are percentages on the 16:10 scheme. They keep a margin from the edges,
// and every pair of pins is far enough apart not to overlap on a 360 px screen.
export const SCOOTERS = Object.freeze(
  [
    {
      id: "s1", name: "Самокат №1", model: "Ninebot Max G30",
      description: "Стоит во дворе жилого квартала — можно стартовать без пробок.",
      battery: 90, tariffKey: "standard", x: 15, y: 26, initiallyBusy: false,
    },
    {
      id: "s2", name: "Самокат №2", model: "Kugoo S3 Pro",
      description: "Лёгкий и манёвренный, хорош для коротких поездок по кварталу.",
      battery: 75, tariffKey: "standard", x: 43, y: 20, initiallyBusy: false,
    },
    {
      id: "s3", name: "Самокат №3", model: "Xiaomi Mi 365",
      description: "Припаркован у Московского проспекта, рядом с переходом.",
      battery: 60, tariffKey: "standard", x: 72, y: 20, initiallyBusy: false,
    },
    {
      id: "s4", name: "Самокат №4", model: "Ninebot Max G30P (Whoosh-класс)",
      description: "Прокатная версия с усиленной рамой, стоит у входа в парк.",
      battery: 50, tariffKey: "standard", x: 85, y: 40, initiallyBusy: false,
    },
    {
      id: "s5", name: "Самокат №5", model: "Kugoo S3 Pro",
      description: "У сквера: хватит, чтобы доехать до ближайшей остановки.",
      battery: 15, tariffKey: "standard", x: 16, y: 64, initiallyBusy: false,
    },
    {
      id: "s6", name: "Самокат №6", model: "Xiaomi Mi 365",
      description: "Во дворе между улицей и проспектом, недалеко от остановки.",
      battery: 18, tariffKey: "standard", x: 46, y: 52, initiallyBusy: false,
    },
    {
      id: "s7", name: "Самокат №7", model: "Ninebot Max G30",
      description: "У Московского проспекта, в южной части района.",
      battery: 80, tariffKey: "standard", x: 56, y: 82, initiallyBusy: true,
    },
    {
      id: "s8", name: "Самокат №8", model: "Xiaomi Mi Pro 2",
      description: "На аллее в парке, широкая дека и мягкий ход.",
      battery: 70, tariffKey: "standard", x: 85, y: 72, initiallyBusy: true,
    },
  ].map(Object.freeze),
);

/* ------------------------------------------------------------------ */
/* Rules, limits, texts                                                */
/* ------------------------------------------------------------------ */

const MAINTENANCE_BELOW = 10; // battery < 10 %: maintenance, hidden everywhere, not bookable
const LOW_BATTERY_BELOW = 20; // battery < 20 %: warning, always at the end of the list
const FULL_CHARGE_RANGE_KM = 40; // rough range on a full battery, shown in the card
export const STORAGE_KEY = "scooter_bookings_v1";
const TOAST_MS = 6000;

const DEFAULT_FILTERS = Object.freeze({ minBattery: 0, tariff: "all" });

const MESSAGES = Object.freeze({
  storageCorrupt: "Не удалось прочитать сохранённые резервы, данные сброшены",
  storageUnavailable: "Хранилище браузера недоступно: резервы пропадут после перезагрузки страницы",
  storageWriteFailed: "Браузер не дал сохранить резервы: после перезагрузки изменения пропадут",
  filterDeselect: "Выбранный самокат больше не подходит фильтрам, выбор снят",
  selectFirst: "Сначала выберите самокат",
});

// Every status has a visible text label and a spoken one; color is never the only signal.
const STATUS = Object.freeze({
  free: { label: "Свободен", spoken: "свободен", mark: "" },
  low: { label: "Низкий заряд", spoken: "свободен, низкий заряд — хватит ненадолго", mark: "!" },
  selected: { label: "Выбран", spoken: "выбран", mark: "✓" },
  busy: { label: "Занят", spoken: "занят другим пользователем, выбрать нельзя", mark: "×" },
  own: { label: "Занят · ваш резерв", spoken: "занят вашим резервом, выбрать нельзя", mark: "×" },
});

const SCOOTER_BY_ID = new Map(SCOOTERS.map((scooter) => [scooter.id, scooter]));

/* ------------------------------------------------------------------ */
/* Pure helpers (no DOM, no storage)                                   */
/* ------------------------------------------------------------------ */

function findPackage(packageKey) {
  return Object.hasOwn(PACKAGES, packageKey) ? PACKAGES[packageKey] : null;
}

// Math.round(amount × 0.85) in integers, so there is no floating-point drift.
function applyPlus(amount, hasSubscription) {
  return hasSubscription ? Math.round((amount * (100 - SUBSCRIPTION.discountPercent)) / 100) : amount;
}

/**
 * What a reservation costs at the start. The rider does not pick the ride length:
 * they end the rental themselves, so the offer is "pay now" + "price of each next minute".
 * - per-minute (no package): start 60 ₽, then 6 ₽/min;
 * - package: package price now (start included), minutes beyond it 6 ₽/min;
 * - «Плюс»: free start and −15% on the ride (package price and minute rate).
 */
export function getOffer(packageKey = NO_PACKAGE, hasSubscription = false) {
  const tariff = TARIFFS.standard;
  const pkg = findPackage(packageKey);
  const fullStartFee = pkg ? 0 : tariff.startFee;
  const startFee = hasSubscription ? 0 : fullStartFee;
  const packagePrice = pkg ? applyPlus(pkg.price, hasSubscription) : 0;

  return {
    packageKey: pkg ? pkg.key : NO_PACKAGE,
    hasSubscription,
    includedMinutes: pkg ? pkg.minutes : 0,
    validDays: pkg ? pkg.validDays : 0,
    fullStartFee,
    startFee,
    fullPackagePrice: pkg ? pkg.price : 0,
    packagePrice,
    packageDiscount: pkg ? pkg.price - packagePrice : 0,
    minuteRate: hasSubscription
      ? (tariff.pricePerMinute * (100 - SUBSCRIPTION.discountPercent)) / 100
      : tariff.pricePerMinute,
    payNow: startFee + packagePrice,
  };
}

/**
 * Cost of a finished ride of `minutes` minutes (known only when the rider ends it).
 * 1) package and minutes <= package minutes -> package price;
 * 2) minutes above the package -> package price + extra minutes × 6;
 * 3) no package -> start 60 ₽ + minutes × 6;
 * 4) «Плюс» -> no start fee, Math.round(ride cost × 0.85).
 */
export function calculatePrice(minutes, packageKey = NO_PACKAGE, hasSubscription = false) {
  const tariff = TARIFFS.standard;
  const pkg = findPackage(packageKey);
  const extraMinutes = pkg ? Math.max(0, minutes - pkg.minutes) : minutes;
  const ride = (pkg ? pkg.price : 0) + extraMinutes * tariff.pricePerMinute;
  const startFee = pkg || hasSubscription ? 0 : tariff.startFee;
  const subtotal = (pkg ? 0 : tariff.startFee) + ride;
  const total = startFee + applyPlus(ride, hasSubscription);
  return { minutes, extraMinutes, startFee, subtotal, discount: subtotal - total, total };
}

export function isInService(scooter) {
  return scooter.battery >= MAINTENANCE_BELOW;
}

export function isLowBattery(scooter) {
  return scooter.battery < LOW_BATTERY_BELOW;
}

export function matchesFilters(scooter, filters) {
  return (
    isInService(scooter) &&
    scooter.battery >= filters.minBattery &&
    (filters.tariff === "all" || scooter.tariffKey === filters.tariff)
  );
}

/**
 * List order: free scooters by battery (high to low), then busy ones,
 * and scooters with battery < 20 % always last (free before busy among them).
 */
export function sortForList(scooters, busyIds) {
  const group = (scooter) => (isLowBattery(scooter) ? 2 : busyIds.has(scooter.id) ? 1 : 0);
  return [...scooters].sort(
    (a, b) =>
      group(a) - group(b) ||
      Number(busyIds.has(a.id)) - Number(busyIds.has(b.id)) ||
      b.battery - a.battery ||
      a.id.localeCompare(b.id),
  );
}

function isValidBooking(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
  const scooter = SCOOTER_BY_ID.get(item.scooterId);
  return (
    typeof item.id === "string" && item.id.trim() !== "" &&
    scooter !== undefined && !scooter.initiallyBusy &&
    typeof item.scooterName === "string" && item.scooterName.trim() !== "" &&
    typeof item.model === "string" &&
    (item.packageKey === NO_PACKAGE || Object.hasOwn(PACKAGES, item.packageKey)) &&
    typeof item.hasSubscription === "boolean" &&
    Number.isFinite(item.total) && item.total >= 0 &&
    typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
  );
}

/** Parses the stored JSON. Broken JSON or a wrong structure gives an empty list and an error. */
export function parseBookings(raw) {
  if (raw === null || raw === undefined) return { bookings: [], error: null };
  const corrupt = { bookings: [], error: MESSAGES.storageCorrupt };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return corrupt;
  }
  if (!Array.isArray(data) || !data.every(isValidBooking)) return corrupt;

  const ids = new Set(data.map((item) => item.id));
  const scooterIds = new Set(data.map((item) => item.scooterId));
  if (ids.size !== data.length || scooterIds.size !== data.length) return corrupt;

  return { bookings: data.map(toBooking), error: null };
}

function toBooking(item) {
  return {
    id: item.id,
    scooterId: item.scooterId,
    scooterName: item.scooterName,
    model: item.model,
    packageKey: item.packageKey,
    hasSubscription: item.hasSubscription,
    total: item.total,
    createdAt: item.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Storage (localStorage)                                              */
/* ------------------------------------------------------------------ */

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadBookings() {
  const storage = getStorage();
  if (!storage) return { bookings: [], error: MESSAGES.storageUnavailable };

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { bookings: [], error: MESSAGES.storageUnavailable };
  }

  const result = parseBookings(raw);
  if (result.error) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else to reset: the app continues with an empty list.
    }
  }
  return result;
}

function saveBookings(bookings) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

// The whole app state. Occupancy is derived from it: ownBookings ∪ initiallyBusy.
const state = {
  selectedId: null,
  filters: { ...DEFAULT_FILTERS },
  ownBookings: [],
};

// View-only data: the form draft and one-off messages. Not part of the domain state.
const ui = {
  form: createDefaultForm(),
  lastBooking: null,
  storageError: null,
  isSubmitting: false,
};

function createDefaultForm() {
  return { packageKey: NO_PACKAGE, hasSubscription: false };
}

function getOccupancy() {
  const ownIds = new Set(state.ownBookings.map((booking) => booking.scooterId));
  const busyIds = new Set(ownIds);
  for (const scooter of SCOOTERS) {
    if (scooter.initiallyBusy) busyIds.add(scooter.id);
  }
  return { ownIds, busyIds };
}

function getStatus(scooter, occupancy) {
  if (occupancy.ownIds.has(scooter.id)) return "own";
  if (occupancy.busyIds.has(scooter.id)) return "busy";
  if (scooter.id === state.selectedId) return "selected";
  return isLowBattery(scooter) ? "low" : "free";
}

function getSelectedScooter() {
  return state.selectedId ? SCOOTER_BY_ID.get(state.selectedId) ?? null : null;
}

function getBookingsNewestFirst() {
  return [...state.ownBookings].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/* ------------------------------------------------------------------ */
/* DOM and formatting helpers                                          */
/* ------------------------------------------------------------------ */

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element;
}

const dom = {
  count: byId("scooters-count"),
  filterBattery: byId("filter-battery"),
  filterTariff: byId("filter-tariff"),
  filtersReset: byId("filters-reset"),
  pins: byId("map-pins"),
  mapEmpty: byId("map-empty"),
  list: byId("scooter-list"),
  listEmpty: byId("list-empty"),
  reserveSuccess: byId("reserve-success"),
  reserveEmpty: byId("reserve-empty"),
  card: byId("scooter-card"),
  cardTitle: byId("card-title"),
  cardModel: byId("card-model"),
  cardStatus: byId("card-status"),
  cardDesc: byId("card-desc"),
  cardBattery: byId("card-battery"),
  cardPrice: byId("card-price"),
  cardWarning: byId("card-warning"),
  form: byId("reserve-form"),
  offerList: byId("offer-list"),
  subscription: byId("subscription"),
  breakdown: byId("price-breakdown"),
  priceNote: byId("price-note"),
  total: byId("price-total"),
  confirm: byId("confirm-btn"),
  confirmSub: byId("confirm-sub"),
  bookingsTitle: byId("bookings-title"),
  bookingsCount: byId("bookings-count"),
  storageAlert: byId("storage-alert"),
  storageAlertText: byId("storage-alert-text"),
  storageAlertClose: byId("storage-alert-close"),
  bookingsEmpty: byId("bookings-empty"),
  bookingList: byId("booking-list"),
  bookingsClear: byId("bookings-clear"),
  tariffGrid: byId("tariff-grid"),
  toast: byId("toast"),
};

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const rateFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function formatRub(value) {
  return `${numberFormat.format(value)} ₽`;
}

// Per-minute prices: whole rubles stay short (6 ₽), fractions get two digits (5,33 ₽).
function formatRate(value) {
  return Number.isInteger(value) ? formatRub(value) : `${rateFormat.format(value)} ₽`;
}

function pluralRu(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDays(count) {
  return `${count} ${pluralRu(count, "день", "дня", "дней")}`;
}

function formatDate(iso) {
  return dateFormat.format(new Date(iso));
}

function tariffPriceText(tariff) {
  return `${formatRub(tariff.startFee)} + ${formatRate(tariff.pricePerMinute)}/мин`;
}

function offerTitle(offer) {
  return offer.includedMinutes ? `${offer.includedMinutes} минут` : TARIFFS.standard.label;
}

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (char) => entities[char]);
}

// Avoids needless DOM mutations, so live regions do not repeat unchanged text.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function closestFrom(event, selector) {
  return event.target instanceof Element ? event.target.closest(selector) : null;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createBookingId() {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/* Rendering: everything below reads from `state` (and `ui` for the form) */
/* ------------------------------------------------------------------ */

function render() {
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined;

  const occupancy = getOccupancy();
  const inService = SCOOTERS.filter(isInService);
  const visible = inService.filter((scooter) => matchesFilters(scooter, state.filters));

  renderFilters();
  setText(dom.count, `Показано: ${visible.length} из ${inService.length}`);
  renderMap(visible, occupancy);
  renderList(sortForList(visible, occupancy.busyIds), occupancy);
  renderCard();
  renderBookings();

  // Map and list are rebuilt; return focus to the same control if it still exists.
  if (focusKey && active instanceof HTMLElement && !active.isConnected) {
    const again = document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (again instanceof HTMLElement) again.focus({ preventScroll: true });
  }
}

function renderFilters() {
  dom.filterBattery.value = String(state.filters.minBattery);
  dom.filterTariff.value = state.filters.tariff;
}

function renderMap(visible, occupancy) {
  dom.pins.innerHTML = visible.map((scooter) => pinHtml(scooter, getStatus(scooter, occupancy))).join("");
  dom.mapEmpty.hidden = visible.length > 0;
}

function pinHtml(scooter, status) {
  const info = STATUS[status];
  const cut = scooter.name.lastIndexOf(" ") + 1;
  const description = `${scooter.name}, ${scooter.model}, заряд ${scooter.battery}%: ${info.spoken}`;
  const mark = info.mark ? `<span class="pin__mark" aria-hidden="true">${info.mark}</span>` : "";
  return `
    <button type="button" class="pin st-${status}" style="left:${scooter.x}%;top:${scooter.y}%"
      data-id="${scooter.id}" data-focus-key="pin-${scooter.id}"
      aria-label="${escapeHtml(description)}" title="${escapeHtml(description)}">
      <span class="pin__icon" aria-hidden="true">🛴</span>
      <span class="pin__label" aria-hidden="true"><span class="pin__prefix">${escapeHtml(scooter.name.slice(0, cut))}</span>${escapeHtml(scooter.name.slice(cut))}</span>
      ${mark}
    </button>`;
}

function renderList(sorted, occupancy) {
  dom.list.innerHTML = sorted.map((scooter) => scooterRowHtml(scooter, getStatus(scooter, occupancy))).join("");
  dom.list.hidden = sorted.length === 0;
  dom.listEmpty.hidden = sorted.length > 0;
}

function batteryHtml(level, withWord) {
  const tone = level < LOW_BATTERY_BELOW ? "low" : level < 50 ? "mid" : "high";
  return `<span class="battery battery--${tone}"><span class="battery__meter" aria-hidden="true"><span class="battery__fill" style="width:${level}%"></span></span>${withWord ? "заряд " : ""}${level}%</span>`;
}

function scooterRowHtml(scooter, status) {
  const info = STATUS[status];
  const blocked = status === "busy" || status === "own";
  const selected = status === "selected";
  const buttonText = selected ? "Выбран" : "Выбрать";
  const mark = info.mark ? `<span aria-hidden="true">${info.mark}</span>` : "";
  const warning = isLowBattery(scooter)
    ? `<p class="warning"><span aria-hidden="true">⚠</span> Низкий заряд — хватит ненадолго</p>`
    : "";
  const classes = ["scooter", selected ? "is-selected" : "", blocked ? "is-busy" : ""].filter(Boolean).join(" ");

  return `
    <li class="${classes}">
      <div class="scooter__head">
        <span class="scooter__icon" aria-hidden="true">🛴</span>
        <div class="scooter__titles">
          <h4 class="scooter__name">${escapeHtml(scooter.name)}</h4>
          <p class="scooter__model">${escapeHtml(scooter.model)}</p>
        </div>
      </div>
      <div class="scooter__meta">
        ${batteryHtml(scooter.battery, true)}
        <span class="scooter__price">${tariffPriceText(TARIFFS[scooter.tariffKey])}</span>
        <span class="badge st-${status}">${mark}${escapeHtml(info.label)}</span>
      </div>
      ${warning}
      <button type="button" class="btn btn--small btn--block ${selected ? "btn--accent" : "btn--pick"}"
        data-action="select" data-id="${scooter.id}" data-focus-key="pick-${scooter.id}"
        aria-label="${buttonText}: ${escapeHtml(scooter.name)}"${blocked ? ' aria-disabled="true"' : ""}>${buttonText}</button>
    </li>`;
}

function renderCard() {
  renderSuccess();
  const scooter = getSelectedScooter();
  dom.reserveEmpty.hidden = scooter !== null;
  dom.card.hidden = scooter === null;
  if (!scooter) return;

  const availability = isLowBattery(scooter) ? "low" : "free";
  const rangeKm = Math.round((scooter.battery / 100) * FULL_CHARGE_RANGE_KM);
  setText(dom.cardTitle, scooter.name);
  setText(dom.cardModel, scooter.model);
  setText(dom.cardDesc, scooter.description);
  dom.cardStatus.className = `badge st-${availability}`;
  setText(dom.cardStatus, STATUS[availability].label);
  dom.cardBattery.innerHTML = `${batteryHtml(scooter.battery, false)}<span class="facts__extra">≈ до ${rangeKm} км</span>`;
  setText(dom.cardPrice, tariffPriceText(TARIFFS[scooter.tariffKey]));
  dom.cardWarning.hidden = !isLowBattery(scooter);

  renderPrice();
}

function renderSuccess() {
  const booking = ui.lastBooking;
  dom.reserveSuccess.hidden = booking === null;
  if (!booking) return;
  const offer = getOffer(booking.packageKey, booking.hasSubscription);
  dom.reserveSuccess.innerHTML = `
    <p class="notice__title"><span aria-hidden="true">✅</span> Резерв оформлен</p>
    <p>${escapeHtml(booking.scooterName)}, ${escapeHtml(offerTitle(offer).toLowerCase())} — к оплате при старте ${formatRub(booking.total)}. Самокат теперь занят, запись добавлена в «Мои резервы».</p>
    <a href="#bookings">Перейти к моим резервам</a>`;
}

// Static offer cards, built once; renderOffers() only updates their prices and selection.
function offerCardHtml(key, name, term) {
  return `
    <label class="offer" data-offer="${key}">
      <input class="offer__input" type="radio" name="offer" value="${key}">
      <span class="offer__dot" aria-hidden="true"></span>
      <span class="offer__main">
        <span class="offer__name">${escapeHtml(name)}</span>
        <span class="offer__term">${escapeHtml(term)}</span>
      </span>
      <span class="offer__side">
        <span class="offer__price"><span class="offer__now" data-role="now"></span><s class="offer__old" data-role="old"></s></span>
        <span class="offer__rate" data-role="rate"></span>
      </span>
    </label>`;
}

function renderOffers() {
  for (const card of dom.offerList.querySelectorAll(".offer")) {
    const offer = getOffer(card.dataset.offer, ui.form.hasSubscription);
    const selected = offer.packageKey === ui.form.packageKey;
    card.classList.toggle("is-selected", selected);
    card.querySelector("input").checked = selected;

    // Crossed-out price: what the same minutes cost on the per-minute tariff without «Плюс».
    const regular = offer.includedMinutes
      ? calculatePrice(offer.includedMinutes, NO_PACKAGE, false).total
      : offer.fullStartFee;
    const old = card.querySelector('[data-role="old"]');
    old.hidden = regular <= offer.payNow;
    old.innerHTML = `<span class="visually-hidden">вместо </span>${formatRub(regular)}`;
    setText(card.querySelector('[data-role="now"]'), formatRub(offer.payNow));
    setText(
      card.querySelector('[data-role="rate"]'),
      offer.includedMinutes
        ? `${formatRate(offer.payNow / offer.includedMinutes)} за минуту`
        : `+ ${formatRate(offer.minuteRate)} за минуту`,
    );
  }
}

function renderPrice() {
  renderOffers();
  dom.subscription.checked = ui.form.hasSubscription;

  const offer = getOffer(ui.form.packageKey, ui.form.hasSubscription);
  dom.breakdown.innerHTML = breakdownRows(offer)
    .map(([label, value, tone]) => `
      <div class="price__row${tone ? ` price__row--${tone}` : ""}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  setText(dom.total, formatRub(offer.payNow));
  setText(dom.priceNote, offerNote(offer));
  setText(
    dom.confirmSub,
    `${offerTitle(offer)}${offer.hasSubscription ? ` и «${SUBSCRIPTION.name}»` : ""} · ${formatRub(offer.payNow)}`,
  );
}

function breakdownRows(offer) {
  const rate = `${formatRate(offer.minuteRate)}/мин`;
  const plusMark = offer.hasSubscription ? ` (−${SUBSCRIPTION.discountPercent}%)` : "";
  const rows = [];
  if (offer.includedMinutes) {
    rows.push([`Пакет ${offer.includedMinutes} минут на ${formatDays(offer.validDays)}`, formatRub(offer.fullPackagePrice)]);
    if (offer.hasSubscription) {
      rows.push([`Скидка «${SUBSCRIPTION.name}» −${SUBSCRIPTION.discountPercent}%`, `−${formatRub(offer.packageDiscount)}`, "discount"]);
    }
    rows.push(["Старт", "0 ₽ (входит в пакет)", "free"]);
    rows.push([`Сверх пакета${plusMark}`, rate, "info"]);
  } else {
    rows.push(offer.hasSubscription
      ? [`Старт по подписке «${SUBSCRIPTION.name}»`, "0 ₽ (бесплатно)", "free"]
      : ["Старт поездки", formatRub(offer.startFee)]);
    rows.push([`Каждая минута поездки${plusMark}`, rate, "info"]);
  }
  return rows;
}

function offerNote(offer) {
  const rate = formatRate(offer.minuteRate);
  return offer.includedMinutes
    ? `Аренду завершаете сами. Пакет действует ${formatDays(offer.validDays)}; когда ${offer.includedMinutes} минут закончатся, дальше ${rate} за минуту.`
    : `Аренду завершаете сами: время поездки не ограничено, дальше ${rate} за каждую минуту.`;
}

function renderBookings() {
  const bookings = getBookingsNewestFirst();
  dom.bookingList.innerHTML = bookings.map(bookingHtml).join("");
  dom.bookingList.hidden = bookings.length === 0;
  dom.bookingsEmpty.hidden = bookings.length > 0;
  dom.bookingsClear.hidden = bookings.length === 0;
  setText(dom.bookingsCount, bookings.length ? `Активных: ${bookings.length}` : "");
  dom.storageAlert.hidden = ui.storageError === null;
  setText(dom.storageAlertText, ui.storageError ?? "");
}

function bookingHtml(booking) {
  const offer = getOffer(booking.packageKey, booking.hasSubscription);
  const rate = `${formatRate(offer.minuteRate)}/мин`;
  const plan = offer.includedMinutes
    ? `пакет ${offer.includedMinutes} минут на ${formatDays(offer.validDays)}, сверх — ${rate}`
    : `поминутно, ${rate}`;
  const parts = [booking.model, plan];
  if (booking.hasSubscription) parts.push(`«${SUBSCRIPTION.name}» −${SUBSCRIPTION.discountPercent}%`);

  return `
    <li class="booking">
      <div class="booking__body">
        <h3 class="booking__title">${escapeHtml(booking.scooterName)}</h3>
        <p class="booking__meta">${escapeHtml(parts.join(" · "))}</p>
        <p class="booking__meta">Оформлен ${escapeHtml(formatDate(booking.createdAt))} · № ${escapeHtml(booking.id)}</p>
      </div>
      <div class="booking__side">
        <p class="booking__total">${formatRub(booking.total)}</p>
        <p class="booking__caption">при старте</p>
        <button type="button" class="btn btn--ghost btn--small" data-action="cancel"
          data-booking-id="${escapeHtml(booking.id)}" data-focus-key="cancel-${escapeHtml(booking.id)}"
          aria-label="Отменить резерв: ${escapeHtml(booking.scooterName)}">Отменить</button>
      </div>
    </li>`;
}

// Static parts built once from the same data objects.
function renderOptions() {
  dom.offerList.innerHTML = [
    offerCardHtml(NO_PACKAGE, TARIFFS.standard.label, "Без лимита по времени"),
    ...Object.values(PACKAGES).map((pkg) => offerCardHtml(pkg.key, `${pkg.minutes} минут`, `На ${formatDays(pkg.validDays)}`)),
  ].join("");
  dom.filterTariff.innerHTML = [
    `<option value="all">Все</option>`,
    ...Object.values(TARIFFS).map((tariff) => `<option value="${tariff.key}">${escapeHtml(tariff.name)}</option>`),
  ].join("");
}

function renderTariffs() {
  const standard = TARIFFS.standard;
  const rows = Object.values(PACKAGES)
    .map((pkg) => {
      const perMinute = pkg.price / pkg.minutes;
      const approx = Number.isInteger(perMinute * 100) ? "" : "≈";
      return `<tr><th scope="row">${pkg.minutes} мин</th><td>${formatDays(pkg.validDays)}</td><td>${formatRub(pkg.price)}</td><td>${approx}${formatRate(perMinute)}</td></tr>`;
    })
    .join("");

  dom.tariffGrid.innerHTML = `
    <article class="tariff">
      <h3 class="tariff__name">«${escapeHtml(standard.name)}» — ${escapeHtml(standard.label.toLowerCase())}</h3>
      <p class="tariff__price">${formatRub(standard.startFee)}<span> старт + ${formatRate(standard.pricePerMinute)}/мин</span></p>
      <p class="tariff__text">Время поездки не выбирается заранее: аренду завершаете сами и платите за фактические минуты.</p>
    </article>
    <article class="tariff">
      <h3 class="tariff__name">Пакеты минут</h3>
      <table class="tariff__table">
        <thead><tr><th scope="col">Пакет</th><th scope="col">Срок</th><th scope="col">Цена</th><th scope="col">За минуту</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="tariff__text">Чем больше пакет — тем ниже стоимость минуты. Старт входит в пакет; когда минуты закончатся — ${formatRate(standard.pricePerMinute)}/мин.</p>
    </article>
    <article class="tariff tariff--plus">
      <h3 class="tariff__name">Подписка «${escapeHtml(SUBSCRIPTION.name)}»</h3>
      <p class="tariff__price">−${SUBSCRIPTION.discountPercent}%</p>
      <p class="tariff__text">Скидка на поездку и пакеты, старт бесплатно вместо ${formatRub(standard.startFee)}. В демо подписка стоит ${formatRub(SUBSCRIPTION.price)}: просто включите её в форме резерва.</p>
    </article>`;
}

/* ------------------------------------------------------------------ */
/* Actions: change state, then render                                  */
/* ------------------------------------------------------------------ */

function selectScooter(id) {
  const scooter = SCOOTER_BY_ID.get(id);
  if (!scooter || !matchesFilters(scooter, state.filters)) return;

  const { ownIds, busyIds } = getOccupancy();
  if (ownIds.has(id)) {
    showToast(`${scooter.name} уже зарезервирован вами. Отменить резерв можно в разделе «Мои резервы».`);
    return;
  }
  if (busyIds.has(id)) {
    showToast(`${scooter.name} занят другим пользователем — выбрать его нельзя.`, "warn");
    return;
  }

  state.selectedId = id;
  ui.lastBooking = null;
  render();
  focusCard();
}

function focusCard() {
  dom.cardTitle.focus({ preventScroll: true });
  const top = dom.card.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight - 120) {
    dom.card.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

function applyFilters(nextFilters) {
  state.filters = { ...nextFilters };
  const selected = getSelectedScooter();
  if (selected && !matchesFilters(selected, state.filters)) {
    state.selectedId = null;
    showToast(MESSAGES.filterDeselect, "warn");
  }
  render();
}

function resetFilters() {
  applyFilters(DEFAULT_FILTERS);
  showToast("Фильтры сброшены. Ваши резервы не изменились.");
}

function onSubmit(event) {
  event.preventDefault();
  if (ui.isSubmitting) return;

  const scooter = getSelectedScooter();
  if (!scooter) {
    showToast(MESSAGES.selectFirst, "warn");
    return;
  }
  // Guards against a second submit for the same scooter: it is busy after the first one.
  if (getOccupancy().busyIds.has(scooter.id)) {
    state.selectedId = null;
    render();
    showToast(`${scooter.name} уже занят — новый резерв не создан.`, "warn");
    return;
  }

  ui.isSubmitting = true;
  dom.confirm.disabled = true;

  const offer = getOffer(ui.form.packageKey, ui.form.hasSubscription);
  const booking = {
    id: createBookingId(),
    scooterId: scooter.id,
    scooterName: scooter.name,
    model: scooter.model,
    packageKey: offer.packageKey,
    hasSubscription: offer.hasSubscription,
    total: offer.payNow,
    createdAt: new Date().toISOString(),
  };

  state.ownBookings = [...state.ownBookings, booking];
  state.selectedId = null;
  ui.lastBooking = booking;
  ui.form = createDefaultForm();
  const saved = saveBookings(state.ownBookings);

  render();
  ui.isSubmitting = false;
  dom.confirm.disabled = false;
  dom.reserveSuccess.focus();
  if (!saved) showToast(MESSAGES.storageWriteFailed, "error");
}

function cancelBooking(bookingId) {
  const shown = getBookingsNewestFirst();
  const index = shown.findIndex((booking) => booking.id === bookingId);
  if (index === -1) return;
  const booking = shown[index];

  state.ownBookings = state.ownBookings.filter((item) => item.id !== bookingId);
  if (ui.lastBooking?.id === bookingId) ui.lastBooking = null;
  const saved = saveBookings(state.ownBookings);
  render();

  const buttons = dom.bookingList.querySelectorAll('button[data-action="cancel"]');
  const next = buttons[Math.min(index, buttons.length - 1)];
  (next ?? dom.bookingsTitle).focus();
  showToast(
    saved ? `Резерв отменён: ${booking.scooterName} снова свободен.` : MESSAGES.storageWriteFailed,
    saved ? "info" : "error",
  );
}

function clearBookings() {
  const count = state.ownBookings.length;
  if (count === 0) return;
  const confirmed = window.confirm(
    `Отменить все ваши резервы (${count})? Самокаты, занятые другими пользователями, останутся занятыми.`,
  );
  if (!confirmed) return;

  state.ownBookings = [];
  ui.lastBooking = null;
  const saved = saveBookings(state.ownBookings);
  render();
  dom.bookingsTitle.focus();
  showToast(saved ? "Все ваши резервы отменены." : MESSAGES.storageWriteFailed, saved ? "info" : "error");
}

// Another tab changed the bookings: reload them so both tabs agree.
function onStorageChange(event) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  const loaded = loadBookings();
  state.ownBookings = loaded.bookings;
  ui.storageError = loaded.error;
  if (ui.lastBooking && !state.ownBookings.some((booking) => booking.id === ui.lastBooking.id)) {
    ui.lastBooking = null;
  }
  const selected = getSelectedScooter();
  if (selected && getOccupancy().busyIds.has(selected.id)) state.selectedId = null;
  render();
  showToast(loaded.error ?? "Резервы обновлены из другой вкладки.", loaded.error ? "error" : "info");
}

/* ------------------------------------------------------------------ */
/* Toast (one polite live region for short messages)                   */
/* ------------------------------------------------------------------ */

let toastTimer = 0;

function showToast(message, tone = "info") {
  window.clearTimeout(toastTimer);
  dom.toast.dataset.tone = tone;
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  dom.toast.classList.remove("is-visible");
}

/* ------------------------------------------------------------------ */
/* Events and start-up                                                 */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.pins.addEventListener("click", (event) => {
    const pin = closestFrom(event, "button[data-id]");
    if (pin) selectScooter(pin.dataset.id);
  });

  dom.list.addEventListener("click", (event) => {
    const button = closestFrom(event, 'button[data-action="select"]');
    if (button) selectScooter(button.dataset.id);
  });

  dom.filterBattery.addEventListener("change", () => {
    applyFilters({ ...state.filters, minBattery: Number(dom.filterBattery.value) });
  });
  dom.filterTariff.addEventListener("change", () => {
    applyFilters({ ...state.filters, tariff: dom.filterTariff.value });
  });
  dom.filtersReset.addEventListener("click", resetFilters);

  dom.offerList.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "offer") {
      ui.form.packageKey = event.target.value;
      renderPrice();
    }
  });
  dom.subscription.addEventListener("change", () => {
    ui.form.hasSubscription = dom.subscription.checked;
    renderPrice();
  });
  dom.form.addEventListener("submit", onSubmit);

  dom.bookingList.addEventListener("click", (event) => {
    const button = closestFrom(event, 'button[data-action="cancel"]');
    if (button) cancelBooking(button.dataset.bookingId);
  });
  dom.bookingsClear.addEventListener("click", clearBookings);
  dom.storageAlertClose.addEventListener("click", () => {
    ui.storageError = null;
    render();
    dom.bookingsTitle.focus();
  });

  dom.toast.addEventListener("click", hideToast);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideToast();
  });
  window.addEventListener("storage", onStorageChange);
}

function init() {
  renderOptions();
  renderTariffs();
  const loaded = loadBookings();
  state.ownBookings = loaded.bookings;
  ui.storageError = loaded.error;
  bindEvents();
  render();
  if (loaded.error) showToast(loaded.error, "error");
}

init();
