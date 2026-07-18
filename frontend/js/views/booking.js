import { api, session } from "../api.js";
import { el, clear, toast } from "../dom.js";
import { ymd, parseYmd, monthGrid, isoWeek, WEEKDAYS, MONTHS, formatRange } from "../dates.js";

// Kalender-booking for valgt hytte. Månedsvisning med ukenummer, dag og dato.
// First-come-first-serve: opptatte dager er markert. Egen (eller admins)
// reservasjon kan slettes.

export function bookingView(container, ctx) {
  let viewYear, viewMonth;
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();

  const root = el("div.view");
  container.append(root);
  renderMonth();

  async function renderMonth() {
    clear(root);

    const grid = monthGrid(viewYear, viewMonth);
    const rangeStart = ymd(grid[0].days[0].date);
    const rangeEnd = ymd(grid[grid.length - 1].days[6].date);

    let bookings = [];
    try {
      bookings = await api.bookings(ctx.cabinId, rangeStart, rangeEnd);
    } catch (err) {
      toast(err.message, "error");
    }

    // Kart fra dato -> booking (FCFS gir maks én per dag).
    const byDay = new Map();
    for (const b of bookings) {
      let d = parseYmd(b.start_date);
      const end = parseYmd(b.end_date);
      while (d <= end) {
        byDay.set(ymd(d), b);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    }

    // Header med måned-navigasjon
    root.append(
      el("div.cal-head", {},
        el("button.iconbtn", { onclick: () => shift(-1), "aria-label": "Forrige måned" }, "‹"),
        el("h2.cal-title", {}, `${MONTHS[viewMonth]} ${viewYear}`),
        el("button.iconbtn", { onclick: () => shift(1), "aria-label": "Neste måned" }, "›")
      )
    );

    // Ukedagsrad
    const head = el("div.cal-grid.cal-grid--head", {}, el("div.cal-wk", {}, "Uke"));
    for (const wd of WEEKDAYS) head.append(el("div.cal-wd", {}, wd));
    root.append(head);

    // Ukene
    const todayStr = ymd(new Date());
    for (const week of grid) {
      const row = el("div.cal-grid", {}, el("div.cal-wk", {}, week.weekNo));
      for (const cell of week.days) {
        const dstr = ymd(cell.date);
        const booking = byDay.get(dstr);
        const classes = ["cal-day"];
        if (!cell.inMonth) classes.push("cal-day--out");
        if (dstr === todayStr) classes.push("cal-day--today");
        if (booking) classes.push("cal-day--booked");
        const dayEl = el(
          "button." + classes.join("."),
          { onclick: () => onDayClick(dstr, booking) },
          el("span.cal-date", {}, cell.date.getDate()),
          booking ? el("span.cal-who", {}, firstName(booking.member_name)) : null
        );
        row.append(dayEl);
      }
      root.append(row);
    }

    // "Ny reservasjon"-knapp (+ "Book for andre" for admin)
    root.append(
      el("button.btn.btn--primary.btn--block", { onclick: () => openForm() }, "+ Ny reservasjon")
    );
    if (session.member.role === "admin") {
      root.append(
        el("button.btn.btn--block", { onclick: () => openForm({ forOther: true }) }, "👥 Book for andre")
      );
    }

    // Liste over kommende reservasjoner
    const upcoming = bookings
      .filter((b) => b.end_date >= todayStr)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const list = el("div.list", {}, el("h3.list-title", {}, "Kommende reservasjoner"));
    if (!upcoming.length) list.append(el("p.muted", {}, "Ingen kommende reservasjoner."));
    for (const b of upcoming) {
      const canDelete = b.member_id === session.member.id || session.member.role === "admin";
      list.append(
        el("div.row", {},
          el("div.row-main", {},
            el("div.row-title", {}, formatRange(b.start_date, b.end_date)),
            el("div.row-sub", {}, b.member_name + (b.note ? ` · ${b.note}` : ""))
          ),
          canDelete
            ? el("button.iconbtn", { onclick: () => openForm({ booking: b }), "aria-label": "Endre" }, "✏️")
            : null,
          canDelete
            ? el("button.iconbtn.iconbtn--danger", { onclick: () => remove(b), "aria-label": "Slett" }, "🗑")
            : null
        )
      );
    }
    root.append(list);
  }

  function shift(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMonth();
  }

  function onDayClick(dstr, booking) {
    if (booking) {
      const mine = booking.member_id === session.member.id || session.member.role === "admin";
      if (mine && confirm(`Slette reservasjonen ${formatRange(booking.start_date, booking.end_date)} (${booking.member_name})?`)) {
        remove(booking);
      }
      return;
    }
    openForm(dstr);
  }

  async function openForm(opts = {}) {
    const booking = opts.booking || null;
    const isEdit = !!booking;
    const isAdmin = session.member.role === "admin";
    const startDate = typeof opts === "string" ? opts : opts.startDate;

    const start = el("input.input", { type: "date", value: booking?.start_date || startDate || "" });
    const end = el("input.input", { type: "date", value: booking?.end_date || startDate || "" });
    const note = el("input.input", { type: "text", placeholder: "Notat (valgfritt)", value: booking?.note || "" });

    // Medlemsvelger — kun admin (for "Book for andre" og for å flytte reservasjon).
    let memberSelect = null;
    if (isAdmin) {
      memberSelect = el("select.select");
      memberSelect.append(el("option", { value: session.member.id }, `${session.member.name} (meg)`));
      try {
        const members = await api.members();
        for (const m of members) {
          if (m.id === session.member.id) continue;
          memberSelect.append(el("option", { value: m.id }, m.name));
        }
      } catch { /* faller tilbake til bare meg */ }
      if (booking) memberSelect.value = booking.member_id;
    }

    const dialog = el("div.modal-backdrop", { onclick: (e) => { if (e.target === dialog) dialog.remove(); } },
      el("div.modal", {},
        el("h3", {}, isEdit ? "Endre reservasjon" : "Ny reservasjon"),
        memberSelect ? el("label.field", {}, "For hvem", memberSelect) : null,
        el("label.field", {}, "Fra", start),
        el("label.field", {}, "Til", end),
        el("label.field", {}, "Notat", note),
        el("div.modal-actions", {},
          el("button.btn", { onclick: () => dialog.remove() }, "Avbryt"),
          el("button.btn.btn--primary", { onclick: submit }, isEdit ? "Lagre" : "Reservér")
        )
      )
    );
    document.body.append(dialog);
    start.addEventListener("change", () => { if (!end.value || end.value < start.value) end.value = start.value; });

    async function submit() {
      if (!start.value || !end.value) return toast("Velg fra- og til-dato", "error");
      const payload = {
        start_date: start.value,
        end_date: end.value,
        note: note.value.trim() || undefined,
      };
      if (memberSelect) payload.member_id = memberSelect.value;
      try {
        if (isEdit) await api.updateBooking(booking.id, payload);
        else await api.createBooking(ctx.cabinId, payload);
        dialog.remove();
        toast(isEdit ? "Reservasjon oppdatert" : "Reservasjon lagret", "success");
        renderMonth();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }

  async function remove(booking) {
    try {
      await api.deleteBooking(booking.id);
      toast("Reservasjon slettet", "success");
      renderMonth();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}
