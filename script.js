// script.js — rewritten, modernized, bug-fixed
'use strict';

/*
  Modern, single-file vanilla-js rewrite of the workout tracker behavior.

  - Keeps same storage keys and UI shape so it's compatible with index.html + style.css
  - Fixes break "skip" bug by tracking actual elapsed seconds on each break row
  - Cleaner separation of concerns, fewer globals, more helper functions
  - Uses const/let, arrow functions, and clearer variable naming
*/

const STORAGE_SETTINGS_KEY = 'wt_settings_v1';
const STORAGE_WORKOUTS_KEY = 'wt_workouts_v1';

// ---------- App state ----------
const App = {
  settings: JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY)) || { defaultUnit: 'kg', appearance: 'light' },
  workouts: JSON.parse(localStorage.getItem(STORAGE_WORKOUTS_KEY)) || [],
  editIndex: null,
  workoutStarted: false,
  workoutSeconds: 0,
  workoutTimerId: null,
  activeRowIndex: null,
  rowTimers: [],                // array of interval IDs (per row) or null
  progressChart: null,
  panelResizeObserver: null
};

// ---------- Utilities ----------
const fmtTime = secs => {
  const s = Math.max(0, parseInt(secs, 10) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};
const saveSettings = () => localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(App.settings));
const saveWorkouts = () => localStorage.setItem(STORAGE_WORKOUTS_KEY, JSON.stringify(App.workouts));
const escapeHtml = str => {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

// ---------- DOM helpers ----------
const $ = id => document.getElementById(id);
const create = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
    else el[k] = v;
  });
  children.forEach(c => { if (c == null) return; if (typeof c === 'string') el.appendChild(document.createTextNode(c)); else el.appendChild(c); });
  return el;
};

// ---------- Appearance ----------
function applyAppearance() {
  document.body.classList.toggle('dark', App.settings.appearance === 'dark');
}

// ---------- Row construction ----------
function ensureTimeCell(row) {
  let timeCell = row.querySelector('.time-cell');
  if (!timeCell) {
    timeCell = create('td', { class: 'time-cell', html: '' });
    const display = create('span', { class: 'time-display', 'data-seconds': 0 }, fmtTime(0));
    timeCell.appendChild(display);
    row.appendChild(timeCell);
  }
  return row.querySelector('.time-display');
}

function createDoneButton(row) {
  let doneCell = row.querySelector('.done-col-cell');
  if (!doneCell) {
    doneCell = create('td', { class: 'done-col-cell' });
    row.insertBefore(doneCell, row.firstChild);
  }
  doneCell.innerHTML = '';
  const btn = create('button', { type: 'button', class: 'row-done-btn', textContent: '✓' });
  btn.title = 'Mark done';
  btn.style.display = App.workoutStarted ? 'inline-block' : 'none';
  btn.addEventListener('click', () => completeRow(row));
  doneCell.appendChild(btn);
  return btn;
}

function wireRowControls(row) {
  const slider = row.querySelector('.difficulty-slider');
  const sliderVal = row.querySelector('.difficulty-value');
  if (slider && sliderVal) slider.addEventListener('input', () => { sliderVal.textContent = slider.value; });

  const dropsetCb = row.querySelector('.dropset-checkbox');
  if (dropsetCb) dropsetCb.addEventListener('change', e => toggleDropSet(e.target));

  const repsInput = row.querySelector('.reps-cell input[type="number"]');
  if (repsInput) repsInput.addEventListener('input', () => updateDropSetInputs(repsInput));
}

// Add exercise row (used both for UI add and when loading saved workout)
function addExercise(ex = {}) {
  const table = $('workoutTable');
  const row = table.insertRow(-1);
  row.className = 'exercise-row';

  const name = escapeHtml(ex.name || '');
  const reps = ex.reps ?? 10;
  const difficulty = ex.difficulty ?? 5;
  const notes = escapeHtml(ex.notes || '');
  const unit = (ex.unit || App.settings.defaultUnit) === 'kg' ? 'kg' : 'lbs';
  const dropset = !!ex.dropset;

  let html = '';
  if (App.workoutStarted) html += '<td class="done-col-cell"></td>';
  html += `
    <td class="exercise-cell"><input type="text" placeholder="Exercise" value="${name}"></td>
    <td class="reps-cell"><input type="number" min="1" value="${reps}"></td>
    <td class="weight-cell">
      <div class="weight-line">
        <input type="number" min="0" class="single-weight" value="${dropset ? '' : (Array.isArray(ex.weights) ? (ex.weights[0] ?? 0) : (ex.weight ?? 0))}">
        <select class="unit-select">
          <option value="kg"${unit === 'kg' ? ' selected' : ''}>kg</option>
          <option value="lbs"${unit === 'lbs' ? ' selected' : ''}>lbs</option>
        </select>
        <label style="font-size:12px;"><input type="checkbox" class="dropset-checkbox"${dropset ? ' checked' : ''}> dropset</label>
      </div>
      <div class="dropset-inputs" style="display:${dropset ? '' : 'none'}"></div>
    </td>
    <td class="difficulty-cell">
      <input type="range" min="1" max="10" value="${difficulty}" class="difficulty-slider">
      <span class="difficulty-value">${difficulty}</span>
    </td>
    <td class="notes-cell"><input type="text" placeholder="Notes" value="${notes}"></td>
    <td class="remove-col"></td>`;

  row.innerHTML = html;

  const removeBtn = create('button', { type: 'button', class: 'row-remove-btn', textContent: 'X', title: 'Remove row' });
  removeBtn.addEventListener('click', () => row.remove());
  row.querySelector('.remove-col').appendChild(removeBtn);

  if (App.workoutStarted) createDoneButton(row);
  wireRowControls(row);

  if (dropset && Array.isArray(ex.weights) && ex.weights.length) {
    const cb = row.querySelector('.dropset-checkbox');
    if (cb) toggleDropSet(cb, ex.weights);
  }

  // restore time if provided (used when editing saved workout)
  if (ex.time != null) {
    ensureTimeCell(row).dataset.seconds = parseInt(ex.time, 10) || 0;
    ensureTimeCell(row).textContent = fmtTime(parseInt(ex.time, 10) || 0);
  }
}

function addBreak(br = {}) {
  const table = $('workoutTable');
  const row = table.insertRow(-1);
  row.className = 'break-row';

  const duration = parseInt(br.duration || br.plannedDuration || 60, 10) || 60;
  if (App.workoutStarted) rowHtmlInsertDoneCol(row);

  const colspan = App.workoutStarted ? 7 : 7;
  row.innerHTML = `<td class="break-cell" colspan="${colspan}" style="text-align:center;">
    Break: <input type="number" min="1" value="${duration}"> sec
  </td>`;

  const remBtn = create('button', { type: 'button', class: 'row-remove-btn', textContent: 'X', title: 'Remove break' });
  remBtn.style.marginLeft = '8px';
  remBtn.addEventListener('click', () => row.remove());
  row.querySelector('.break-cell').appendChild(remBtn);

  // dataset planned duration
  row.dataset.plannedDuration = duration;

  // Setup break runtime tracking values:
  // paused boolean not needed, but we track _timeLeft, _elapsed, and _countdown interval id
  row._timeLeft = duration;
  row._elapsed = br.time != null ? parseInt(br.time, 10) || 0 : 0;
  row._countdown = null;

  if (App.workoutStarted) createDoneButton(row);
  // restore visible time cell if pre-filled
  if (br.time != null) {
    ensureTimeCell(row).dataset.seconds = row._elapsed;
    ensureTimeCell(row).textContent = fmtTime(row._elapsed);
  }
}

function rowHtmlInsertDoneCol(row) {
  // helper for addBreak if we want to insert a done-col cell before the rest (kept for parity)
  if (!row.querySelector('.done-col-cell')) {
    const td = create('td', { class: 'done-col-cell' });
    row.insertBefore(td, row.firstChild);
  }
}

// ---------- Dropset helpers ----------
function toggleDropSet(checkbox, restoreValues = []) {
  const row = checkbox.closest('tr');
  if (!row) return;
  const dropsetContainer = row.querySelector('.dropset-inputs');
  const singleWeight = row.querySelector('.single-weight');
  const repsInput = row.querySelector('.reps-cell input[type="number"]');
  if (dropsetContainer) dropsetContainer.innerHTML = '';

  if (checkbox.checked) {
    if (dropsetContainer) dropsetContainer.style.display = '';
    if (singleWeight) singleWeight.style.display = 'none';
    const count = Math.max(1, parseInt(repsInput?.value || 1, 10));
    for (let i = 0; i < count; i++) {
      const w = create('input', { type: 'number', min: '0', value: (restoreValues[i] != null) ? restoreValues[i] : (i === 0 && singleWeight && singleWeight.value ? singleWeight.value : 0) });
      dropsetContainer.appendChild(w);
    }
  } else {
    if (dropsetContainer) dropsetContainer.style.display = 'none';
    if (dropsetContainer) dropsetContainer.innerHTML = '';
    if (singleWeight) singleWeight.style.display = '';
    if (restoreValues.length && singleWeight) singleWeight.value = restoreValues[0];
  }
}

function updateDropSetInputs(repsInput) {
  const row = repsInput.closest('tr');
  if (!row) return;
  const dropsetCb = row.querySelector('.dropset-checkbox');
  if (!dropsetCb || !dropsetCb.checked) return;
  const container = row.querySelector('.dropset-inputs');
  const current = Array.from(container.querySelectorAll('input'));
  const newCount = Math.max(1, parseInt(repsInput.value || 1, 10));
  if (current.length < newCount) {
    const lastVal = current.length ? current[current.length - 1].value : 0;
    for (let i = current.length; i < newCount; i++) {
      const w = create('input', { type: 'number', min: '0', value: lastVal || 0 });
      container.appendChild(w);
    }
  } else if (current.length > newCount) {
    for (let i = current.length - 1; i >= newCount; i--) container.removeChild(current[i]);
  }
}

// ---------- Timers per row (stopwatch behavior) ----------
function startRowTimer(index) {
  const rows = Array.from($('workoutTable').rows).slice(1);
  if (index < 0 || index >= rows.length) return;
  if (App.activeRowIndex !== null && App.activeRowIndex !== index) stopRowTimer(App.activeRowIndex);

  const row = rows[index];
  const display = ensureTimeCell(row);
  let elapsed = parseInt(display.dataset.seconds || '0', 10) || 0;

  if (App.rowTimers[index]) clearInterval(App.rowTimers[index]);
  App.rowTimers[index] = setInterval(() => {
    elapsed++;
    display.dataset.seconds = elapsed;
    display.textContent = fmtTime(elapsed);
  }, 1000);

  App.activeRowIndex = index;
}

function stopRowTimer(index) {
  if (App.rowTimers[index]) {
    clearInterval(App.rowTimers[index]);
    App.rowTimers[index] = null;
  }
  if (App.activeRowIndex === index) App.activeRowIndex = null;
}

function computeTotalFromRows() {
  const rows = Array.from($('workoutTable').rows).slice(1);
  return rows.reduce((sum, r) => sum + (parseInt(r.querySelector('.time-display')?.dataset.seconds || '0', 10) || 0), 0);
}

// ---------- Workout global timer ----------
function startWorkoutTimer() {
  const display = $('workoutTotalTimer');
  App.workoutSeconds = 0;
  if (App.workoutTimerId) clearInterval(App.workoutTimerId);
  App.workoutTimerId = setInterval(() => {
    App.workoutSeconds++;
    display.textContent = 'Total Time: ' + fmtTime(App.workoutSeconds);
  }, 1000);
}
function stopWorkoutTimer() {
  if (App.workoutTimerId) {
    clearInterval(App.workoutTimerId);
    App.workoutTimerId = null;
  }
}

// ---------- Break countdowns (fixed) ----------
// Important: we track both _timeLeft and _elapsed for each break row
function startBreakCountdown(breakRow) {
  const cell = breakRow.querySelector('.break-cell');
  if (!cell) return;

  const planned = parseInt(breakRow.dataset.plannedDuration || 0, 10) || 60;
  breakRow.dataset.plannedDuration = planned;

  // initialize runtime trackers if missing
  if (breakRow._timeLeft == null) breakRow._timeLeft = planned;
  if (breakRow._elapsed == null) breakRow._elapsed = 0;
  if (breakRow._countdown) {
    // already running
    return;
  }

  ensureTimeCell(breakRow); // ensure there's a time-display

  // clean the cell and build UI
  cell.innerHTML = '';
  const display = create('span', { class: 'break-countdown' });
  cell.appendChild(display);

  const btnAdd = create('button', { type: 'button', class: 'small', textContent: '+10s' });
  const btnSub = create('button', { type: 'button', class: 'small', textContent: '-10s' });
  const btnReset = create('button', { type: 'button', class: 'small', textContent: 'Reset' });
  const btnSkip = create('button', { type: 'button', class: 'small', textContent: 'Skip' });

  [btnAdd, btnSub, btnReset, btnSkip].forEach(b => {
    b.style.padding = '6px 8px';
    b.style.marginLeft = '6px';
    cell.appendChild(b);
  });

  const updateDisplay = () => {
    const left = breakRow._timeLeft;
    if (left <= 0) {
      display.textContent = 'Break complete!';
      breakRow.classList.remove('break-warning');
      breakRow.classList.add('break-done');

      if (breakRow._countdown) {
        clearInterval(breakRow._countdown);
        breakRow._countdown = null;
      }

      // record actual elapsed seconds (this is the fix: use _elapsed not planned)
      const timeDisplay = breakRow.querySelector('.time-display');
      if (timeDisplay) {
        // ensure elapsed is integer
        timeDisplay.dataset.seconds = parseInt(breakRow._elapsed || 0, 10) || 0;
        timeDisplay.textContent = fmtTime(parseInt(breakRow._elapsed || 0, 10) || 0);
      }

      // move to next row (stop this row's timer)
      const rows = Array.from($('workoutTable').rows).slice(1);
      const idx = rows.indexOf(breakRow);
      stopRowTimer(idx);
      if (idx + 1 < rows.length) {
        const next = rows[idx + 1];
        startRowTimer(idx + 1);
        if (next.classList.contains('break-row')) {
          // prepare next break and start it
          const inp = next.querySelector('.break-cell input[type="number"]');
          if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
          next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
          next._elapsed = 0;
          startBreakCountdown(next);
        }
      } else {
        // no next -> workout might end when last element complete - handled by completeRow chain or start workout logic
      }
    } else {
      display.textContent = 'Break: ' + left + 's';
      if (left <= 10) breakRow.classList.add('break-warning');
      else breakRow.classList.remove('break-warning');
    }
  };

  const restartCountdown = () => {
    if (breakRow._timeLeft > 0 && !breakRow._countdown) {
      breakRow._countdown = setInterval(() => {
        breakRow._timeLeft = Math.max(0, breakRow._timeLeft - 1);
        breakRow._elapsed = (parseInt(breakRow._elapsed, 10) || 0) + 1;
        updateDisplay();
      }, 1000);
    }
  };

  btnAdd.addEventListener('click', () => {
    breakRow._timeLeft = (parseInt(breakRow._timeLeft, 10) || 0) + 10;
    updateDisplay();
    restartCountdown();
  });
  btnSub.addEventListener('click', () => {
    // subtracting time: if timeLeft goes to 0 instantly, elapsed does not increase except the existing elapsed
    breakRow._timeLeft = Math.max(0, (parseInt(breakRow._timeLeft, 10) || 0) - 10);
    updateDisplay();
    restartCountdown();
  });
  btnReset.addEventListener('click', () => {
    breakRow._timeLeft = parseInt(breakRow.dataset.plannedDuration || 0, 10) || 0;
    breakRow._elapsed = 0;
    updateDisplay();
    restartCountdown();
  });

  btnSkip.addEventListener('click', () => {
    // Important: when skipping we want to record only the elapsed seconds so far,
    // not add planned duration. So set _timeLeft to 0 (to trigger completion) but keep _elapsed as-is.
    breakRow._timeLeft = 0;
    updateDisplay();
  });

  // initial render & start
  updateDisplay();
  restartCountdown();
}

// ---------- Completing a row ----------
function completeRow(row) {
  const table = $('workoutTable');
  const rows = Array.from(table.rows).slice(1);
  const idx = rows.indexOf(row);
  if (idx < 0) return;

  if (row.classList.contains('break-row')) {
    if (row._countdown) {
      clearInterval(row._countdown);
      row._countdown = null;
    }
    row.classList.remove('break-warning');
    row.classList.add('break-done');

    // ensure the time display records proper elapsed seconds if not already set
    const td = row.querySelector('.time-display');
    if (td) {
      td.dataset.seconds = parseInt(row._elapsed || 0, 10) || 0;
      td.textContent = fmtTime(parseInt(row._elapsed || 0, 10) || 0);
    }
  } else {
    row.classList.add('exercise-done');
  }

  stopRowTimer(idx);

  // start next row's timer and possibly a break
  if (idx + 1 < rows.length) {
    const next = rows[idx + 1];
    startRowTimer(idx + 1);
    if (next.classList.contains('break-row')) {
      const inp = next.querySelector('.break-cell input[type="number"]');
      if (inp) next.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
      next._timeLeft = parseInt(next.dataset.plannedDuration || 0, 10) || 0;
      next._elapsed = 0;
      startBreakCountdown(next);
    }
  } else {
    // last row finished -> end workout
    endWorkout();
    const btn = $('startWorkoutBtn');
    btn.textContent = 'Start';
    btn.dataset.active = 'false';
    btn.classList.remove('end');
    document.body.classList.remove('show-workout');
  }
}

// ---------- Start / End workout ----------
function startWorkout() {
  const btn = $('startWorkoutBtn');
  const table = $('workoutTable');
  const rows = Array.from(table.rows).slice(1);

  if (btn.dataset.active === 'true') {
    // End
    endWorkout();
    btn.textContent = 'Start';
    btn.dataset.active = 'false';
    btn.classList.remove('end');
    document.body.classList.remove('show-workout');

    // clean up done column header & cells
    const header = $('headerRow');
    if (header && header.querySelector('.done-col')) header.querySelector('.done-col').remove?.();

    Array.from(table.rows).forEach(r => {
      const doneCell = r.querySelector('.done-col-cell');
      if (doneCell) doneCell.remove();
    });
    return;
  }

  if (!rows.length) {
    alert('Add at least one exercise first.');
    return;
  }

  document.body.classList.add('show-workout');

  // ensure header has done-col
  const header = $('headerRow');
  if (header && !header.querySelector('.done-col')) {
    const th = create('th', { class: 'done-col', textContent: '✓' });
    header.insertBefore(th, header.firstChild);
  }

  rows.forEach(r => {
    if (!r.querySelector('.done-col-cell')) {
      const td = create('td', { class: 'done-col-cell' });
      r.insertBefore(td, r.firstChild);
    }
    const doneBtn = createDoneButton(r);
    doneBtn.style.display = 'inline-block';

    if (r.classList.contains('break-row')) {
      const inp = r.querySelector('.break-cell input[type="number"]');
      if (inp) r.dataset.plannedDuration = parseInt(inp.value || 0, 10) || 0;
      r._timeLeft = parseInt(r.dataset.plannedDuration || 0, 10) || 0;
      r._elapsed = 0;
    }

    ensureTimeCell(r);
  });

  btn.textContent = 'End';
  btn.dataset.active = 'true';
  btn.classList.add('end');
  $('workoutTotalTimer').style.display = 'block';
  $('workoutTotalTimer').textContent = 'Total Time: 00:00';
  App.workoutStarted = true;

  // start first row
  startRowTimer(0);
  const first = rows[0];
  if (first && first.classList.contains('break-row')) {
    first.dataset.plannedDuration = parseInt(first.dataset.plannedDuration || 0, 10) || 0;
    first._timeLeft = parseInt(first.dataset.plannedDuration || 0, 10) || 0;
    first._elapsed = 0;
    startBreakCountdown(first);
  }

  startWorkoutTimer();
}

function endWorkout() {
  // stop all row timers
  App.rowTimers.forEach((id, i) => { if (id) clearInterval(id); App.rowTimers[i] = null; });
  App.activeRowIndex = null;

  // clear break countdowns
  const rows = Array.from($('workoutTable').rows).slice(1);
  rows.forEach(r => {
    if (r._countdown) { clearInterval(r._countdown); r._countdown = null; }
    r.classList.remove('break-warning');
  });

  stopWorkoutTimer();
  App.workoutStarted = false;

  // hide done buttons
  rows.forEach(r => {
    const doneBtn = r.querySelector('.done-col-cell button');
    if (doneBtn) doneBtn.style.display = 'none';
  });
}

// ---------- Save / Edit / Delete / Cancel ----------
function saveWorkout() {
  // end workout to freeze timers
  endWorkout();

  const table = $('workoutTable');
  const rows = Array.from(table.rows).slice(1);
  if (!rows.length) { alert('Add at least one exercise!'); return; }

  const exercises = rows.map(r => {
    const td = r.querySelector('.time-display');
    const secs = parseInt(td?.dataset.seconds || 0, 10) || 0;

    if (r.classList.contains('break-row')) {
      const planned = parseInt(r.dataset.plannedDuration || 0, 10) || (parseInt(r.querySelector('.break-cell input')?.value || 0, 10) || 0);
      return { type: 'break', duration: planned, time: secs };
    } else {
      const name = r.querySelector('.exercise-cell input')?.value || '';
      const reps = parseInt(r.querySelector('.reps-cell input')?.value || 0, 10) || 0;
      let weights = [];
      if (r.querySelector('.dropset-checkbox')?.checked) {
        weights = Array.from(r.querySelectorAll('.dropset-inputs input')).map(i => i.value || 0);
      } else {
        weights = [r.querySelector('.single-weight')?.value || 0];
      }
      const unit = r.querySelector('.unit-select')?.value || App.settings.defaultUnit;
      const difficulty = parseInt(r.querySelector('.difficulty-slider')?.value || 0, 10) || 0;
      const notes = r.querySelector('.notes-cell input')?.value || '';
      return {
        type: 'exercise',
        name,
        reps,
        weights,
        unit,
        dropset: !!r.querySelector('.dropset-checkbox')?.checked,
        difficulty,
        notes,
        time: secs
      };
    }
  });

  // compute total time
  let totalTime = 0;
  if (App.workoutSeconds && App.workoutStarted) {
    totalTime = App.workoutSeconds;
  } else {
    totalTime = exercises.reduce((s, ex) => s + (parseInt(ex.time || 0, 10) || 0), 0);
  }

  if (App.editIndex != null) {
    App.workouts[App.editIndex].exercises = exercises;
    App.workouts[App.editIndex].date = new Date().toLocaleString();
    App.workouts[App.editIndex].totalTime = totalTime;
    App.editIndex = null;
    $('cancelEditBtn').style.display = 'none';
  } else {
    App.workouts.push({ date: new Date().toLocaleString(), exercises, totalTime });
  }

  saveWorkouts();
  renderHistory();
  updateExerciseSelector();
  renderProgress();

  // reset table but keep header
  const headerHtml = $('workoutTable').rows[0].outerHTML;
  $('workoutTable').innerHTML = headerHtml;

  App.workoutSeconds = 0;
  App.workoutStarted = false;
  $('workoutTotalTimer').style.display = 'none';
  document.body.classList.remove('show-workout');

  const btn = $('startWorkoutBtn');
  btn.textContent = 'Start';
  btn.dataset.active = 'false';
  btn.classList.remove('end');
}

function editWorkout(index) {
  const table = $('workoutTable');
  // reset to header row
  table.innerHTML = table.rows[0].outerHTML;
  const w = App.workouts[index];
  (w.exercises || []).forEach(ex => {
    if (ex.type === 'break') addBreak(ex);
    else addExercise(ex);
  });
  App.editIndex = index;
  $('cancelEditBtn').style.display = 'inline-block';
  $('workoutTotalTimer').style.display = 'block';
  $('workoutTotalTimer').textContent = 'Total Time: ' + fmtTime(w.totalTime || 0);

  // restore time displays
  const rows = Array.from($('workoutTable').rows).slice(1);
  rows.forEach((r, i) => {
    const original = (w.exercises || [])[i];
    if (!original) return;
    ensureTimeCell(r);
    const td = r.querySelector('.time-display');
    if (td) td.dataset.seconds = parseInt(original.time || 0, 10) || 0;
    if (r.classList.contains('break-row')) {
      r.dataset.plannedDuration = parseInt(original.duration || 0, 10) || 0;
      r._timeLeft = parseInt(original.duration || 0, 10) || 0;
      r._elapsed = parseInt(original.time || 0, 10) || 0;
    }
  });
}

function deleteWorkout(index) {
  if (!confirm('Are you sure you want to delete this workout?')) return;
  App.workouts.splice(index, 1);
  saveWorkouts();
  renderHistory();
  updateExerciseSelector();
  renderProgress();
}

function cancelEdit() {
  App.editIndex = null;
  $('cancelEditBtn').style.display = 'none';
  $('workoutTable').innerHTML = $('workoutTable').rows[0].outerHTML;
  $('workoutTotalTimer').style.display = 'none';
  App.workoutStarted = false;
  App.workoutSeconds = 0;
}

// ---------- History & UI rendering ----------
function renderHistory() {
  const historyDiv = $('history');
  historyDiv.innerHTML = '';

  // show newest first
  App.workouts.slice().reverse().forEach((workout, i) => {
    const actualIndex = App.workouts.length - 1 - i;
    const div = create('div', { class: 'history-entry' });
    const strong = create('strong', {}, workout.date);
    const span = create('span', {}, ' Total Time: ' + fmtTime(workout.totalTime || 0));

    const editBtn = create('button', { class: 'edit-btn', textContent: 'Edit' });
    editBtn.addEventListener('click', () => editWorkout(actualIndex));

    const delBtn = create('button', { class: 'delete-btn', textContent: 'Delete' });
    delBtn.addEventListener('click', () => deleteWorkout(actualIndex));

    // table for entries
    const table = create('table', { class: 'history-table' });
    const thead = create('tr', { html: '\
      <th>Time</th>\
      <th>Exercise</th>\
      <th>Reps</th>\
      <th>Weight</th>\
      <th>Difficulty</th>\
      <th>Notes</th>' });
    table.appendChild(thead);

    (workout.exercises || []).forEach(ex => {
      const tr = create('tr');
      if (ex.type === 'break') {
        tr.innerHTML = `<td>${fmtTime(ex.time || 0)}</td><td colspan="5" style="text-align:center; font-style:italic;">Break: ${ex.duration || 0} sec</td>`;
      } else {
        const repsDisplay = ex.reps || 0;
        const weightsDisplay = ex.dropset ? (Array.isArray(ex.weights) ? ex.weights.join(' → ') : ex.weights) : (Array.isArray(ex.weights) ? ex.weights[0] : ex.weights);
        const unit = ex.unit || App.settings.defaultUnit;
        const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
        tr.innerHTML = '<td>' + fmtTime(ex.time || 0) + '</td>' +
          '<td>' + escapeHtml(ex.name || '') + '</td>' +
          '<td>' + escapeHtml(String(repsDisplay)) + '</td>' +
          '<td>' + escapeHtml(String(weightsDisplay || '0')) + ' ' + escapeHtml(unit) + (ex.dropset ? ' (dropset)' : '') + '</td>' +
          '<td>' + escapeHtml(String(difficultyDisplay)) + '/10</td>' +
          '<td>' + escapeHtml(ex.notes || '') + '</td>';
      }
      table.appendChild(tr);
    });

    const wrap = create('div', { class: 'table-wrapper' }, table);

    div.appendChild(strong);
    div.appendChild(span);
    div.appendChild(editBtn);
    div.appendChild(delBtn);
    div.appendChild(wrap);
    historyDiv.appendChild(div);
  });
}

function updateExerciseSelector() {
  const select = $('exerciseSelect');
  if (!select) return;
  const names = new Set();
  App.workouts.forEach(w => {
    (w.exercises || []).forEach(ex => {
      if (ex.type === 'exercise' && ex.name && ex.name.trim()) names.add(ex.name.trim());
    });
  });
  const current = select.value || '__all';
  select.innerHTML = '';
  const allOpt = create('option', { value: '__all', textContent: 'All exercises' });
  select.appendChild(allOpt);
  Array.from(names).sort().forEach(n => {
    const o = create('option', { value: n, textContent: n });
    select.appendChild(o);
  });
  select.value = Array.from(select.querySelectorAll('option')).some(o => o.value === current) ? current : '__all';
}

// ---------- Progress charting (kept compatible with original) ----------
function chartColors() {
  return App.settings.appearance === 'dark' ? { grid: '#555', tick: '#ccc', legend: '#ddd' } : { grid: '#ddd', tick: '#333', legend: '#111' };
}

function buildProgressData(selected) {
  let labels = [], difficultyData = [], weightData = [], durationData = [], breakData = [];

  if (selected === '__all') {
    labels = App.workouts.map(w => w.date);
    difficultyData = App.workouts.map(w => {
      const exs = (w.exercises || []).filter(e => e.type !== 'break');
      if (!exs.length) return 0;
      const total = exs.reduce((sum, ex) => sum + (parseFloat(ex.difficulty || 0) || 0), 0);
      return total / exs.length;
    });
    weightData = App.workouts.map(w => {
      return (w.exercises || []).filter(e => e.type !== 'break').reduce((sum, ex) => {
        const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
        const reps = parseInt(ex.reps || 1, 10) || 1;
        const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
        return sum + volume;
      }, 0);
    });
    durationData = App.workouts.map(w => w.totalTime || 0);
    breakData = App.workouts.map(w => {
      return (w.exercises || []).filter(e => e.type === 'break').reduce((sum, br) => sum + (parseInt(br.time || br.duration || 0, 10) || 0), 0);
    });
  } else {
    App.workouts.forEach(w => {
      const matches = (w.exercises || []).filter(ex => ex.type !== 'break' && ex.name && ex.name.trim() === selected);
      if (!matches.length) return;
      labels.push(w.date);
      const avgDiff = matches.reduce((s, ex) => s + (parseFloat(ex.difficulty || 0) || 0), 0) / matches.length;
      difficultyData.push(avgDiff);
      const totalVolume = matches.reduce((s, ex) => {
        const weightsArr = Array.isArray(ex.weights) ? ex.weights : [ex.weights];
        const reps = parseInt(ex.reps || 1, 10) || 1;
        const volume = weightsArr.reduce((a, b) => a + (parseFloat(b || 0) || 0), 0) * reps;
        return s + volume;
      }, 0);
      weightData.push(totalVolume);
      const duration = matches.reduce((s, ex) => s + (parseInt(ex.time || 0, 10) || 0), 0);
      durationData.push(duration);
      let afters = [];
      const exs = w.exercises || [];
      for (let i = 0; i < exs.length; i++) {
        if (exs[i].type === 'exercise' && exs[i].name && exs[i].name.trim() === selected && exs[i + 1] && exs[i + 1].type === 'break') {
          afters.push(parseInt(exs[i + 1].time || exs[i + 1].duration || 0, 10) || 0);
        }
      }
      breakData.push(afters.length ? (afters.reduce((a, b) => a + b, 0) / afters.length) : 0);
    });
  }

  if (!labels.length) {
    labels = ['No data'];
    difficultyData = [0];
    weightData = [0];
    durationData = [0];
    breakData = [0];
  }
  return { labels, difficultyData, weightData, durationData, breakData };
}

function createOrUpdateProgressChart(type, labels, data, datasetLabel) {
  const canvas = $('progressChart');
  if (!canvas) return;
  const colors = chartColors();
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: datasetLabel,
        data,
        borderColor: 'rgb(38,115,255)',
        backgroundColor: 'rgba(38,115,255,0.1)',
        fill: true,
        tension: 0.2,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { display: false, grid: { drawTicks: false, drawBorder: false } }, y: { grid: { color: colors.grid }, ticks: { color: colors.tick } } },
      plugins: { legend: { labels: { color: colors.legend } }, tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } } }
    }
  };
  if (type === 'weight') { cfg.data.datasets[0].borderColor = 'rgb(34,197,94)'; cfg.data.datasets[0].backgroundColor = 'rgba(34,197,94,0.1)'; }
  else if (type === 'duration') { cfg.data.datasets[0].borderColor = 'rgb(255,165,0)'; cfg.data.datasets[0].backgroundColor = 'rgba(255,165,0,0.1)'; }
  else if (type === 'break') { cfg.data.datasets[0].borderColor = 'rgb(255,44,44)'; cfg.data.datasets[0].backgroundColor = 'rgba(255,44,44,0.1)'; }
  else { cfg.options.scales.y.suggestedMin = 0; cfg.options.scales.y.suggestedMax = 10; }

  if (App.progressChart) {
    App.progressChart.config.type = cfg.type;
    App.progressChart.config.data = cfg.data;
    App.progressChart.options = cfg.options;
    App.progressChart.update();
  } else {
    App.progressChart = new Chart(canvas.getContext('2d'), cfg);
  }

  setTimeout(() => {
    try {
      const panel = canvas.closest('.progress-panel');
      if (panel) panel.style.minHeight = canvas.clientHeight + 'px';
    } catch (e) { /* ignore */ }
  }, 60);
}

function renderProgress() {
  updateExerciseSelector();
  const selected = $('exerciseSelect')?.value || '__all';
  const chartType = $('chartSelect')?.value || 'difficulty';
  const d = buildProgressData(selected);
  let labels = d.labels, data = [], datasetLabel = '';

  if (chartType === 'difficulty') {
    data = d.difficultyData;
    datasetLabel = selected === '__all' ? 'Avg Difficulty (all exercises)' : `Avg Difficulty — ${selected}`;
  } else if (chartType === 'weight') {
    data = d.weightData;
    datasetLabel = selected === '__all' ? `Total Load (Volume) (${App.settings.defaultUnit})` : `Total Load — ${selected} (${App.settings.defaultUnit})`;
  } else if (chartType === 'duration') {
    data = d.durationData;
    datasetLabel = selected === '__all' ? 'Workout Duration (sec)' : `Duration — ${selected} (sec)`;
  } else if (chartType === 'break') {
    data = d.breakData;
    datasetLabel = selected === '__all' ? 'Total Break Time (sec)' : `Avg Break After — ${selected} (sec)`;
  }

  createOrUpdateProgressChart(chartType, labels, data, datasetLabel);

  // nudge layout to reserve space
  setTimeout(() => {
    const canvas = $('progressChart');
    const panel = canvas?.closest('.progress-panel');
    if (canvas && panel) {
      const h = canvas.clientHeight;
      if (h && h > 0) panel.style.minHeight = h + 'px';
    }
  }, 80);
}

function attachPanelResizeObserver() {
  const canvas = $('progressChart');
  if (!canvas) return;
  if (App.panelResizeObserver) App.panelResizeObserver.disconnect();
  App.panelResizeObserver = new ResizeObserver(() => {
    if (App.progressChart) {
      try { App.progressChart.resize(); } catch (e) { /* ignore */ }
    }
  });
  App.panelResizeObserver.observe(canvas);
}

// ---------- Init & wiring ----------
document.addEventListener('DOMContentLoaded', () => {
  applyAppearance();

  // settings modal wiring
  $('settingsBtn').addEventListener('click', () => {
    $('settingsModal').style.display = 'flex';
    $('defaultUnit').value = App.settings.defaultUnit || 'kg';
    $('appearance').value = App.settings.appearance || 'light';
  });
  $('closeSettingsBtn').addEventListener('click', () => $('settingsModal').style.display = 'none');
  $('saveSettingsBtn').addEventListener('click', () => {
    App.settings.defaultUnit = $('defaultUnit').value;
    App.settings.appearance = $('appearance').value;
    saveSettings();
    applyAppearance();
    $('settingsModal').style.display = 'none';
    renderProgress();
  });

  // main buttons
  $('addExerciseBtn').addEventListener('click', () => addExercise());
  $('addBreakBtn').addEventListener('click', () => addBreak());
  $('saveWorkoutBtn').addEventListener('click', saveWorkout);
  $('startWorkoutBtn').addEventListener('click', startWorkout);
  $('cancelEditBtn').addEventListener('click', cancelEdit);

  // progress filters
  $('exerciseSelect').addEventListener('change', renderProgress);
  $('chartSelect').addEventListener('change', renderProgress);

  // initial render
  renderHistory();
  updateExerciseSelector();
  renderProgress();
  attachPanelResizeObserver();

  // tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.main-panel, .progress-panel, .history-panel');
  document.querySelector('.main-panel').classList.add('active');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      panels.forEach(p => p.classList.remove('active'));
      const targetPanel = document.querySelector('.' + btn.dataset.target);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });
});