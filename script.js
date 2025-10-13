		//	Tabs used for indentation.
		//	No inline onclick; wired with addEventListener.
		//	Mobile-first logic, all features preserved.

		let settings = JSON.parse(localStorage.getItem("settings")) || { defaultUnit: "kg", appearance: "light" };
		let workouts = JSON.parse(localStorage.getItem("workouts")) || [];
		let editIndex = null;
		let difficultyChart = null;
		let weightChart = null;

		let activeRowIndex = null;
		let rowTimers = [];
		let workoutTimer = null;
		let workoutSeconds = 0;
		let workoutStarted = false;

		//	Helpers
		function toDefaultUnit(value, unit)
		{
			const def = settings.defaultUnit || "kg";
			if (!value) return 0;
			value = parseFloat(value) || 0;
			if (unit === def) return value;
			if (def === "kg" && unit === "lbs") return value * 0.453592;
			if (def === "lbs" && unit === "kg") return value * 2.20462;
			return value;
		}

		function formatTime(secs)
		{
			const s = Math.max(0, parseInt(secs) || 0);
			const h = Math.floor(s / 3600);
			const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
			const ss = (s % 60).toString().padStart(2, "0");
			return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
		}

		//	Settings
		function applyAppearance()
		{
			document.body.classList.toggle('dark', settings.appearance === 'dark');
		}

		function openSettings()
		{
			document.getElementById("defaultUnit").value = settings.defaultUnit || "kg";
			document.getElementById("appearance").value = settings.appearance || "light";
			document.getElementById("settingsModal").style.display = "flex";
		}

		function closeSettings()
		{
			document.getElementById("settingsModal").style.display = "none";
		}

		function saveSettings()
		{
			settings.defaultUnit = document.getElementById("defaultUnit").value;
			settings.appearance = document.getElementById("appearance").value;
			localStorage.setItem("settings", JSON.stringify(settings));
			applyAppearance();
			closeSettings();
			renderProgress();
		}

		applyAppearance();

		//	Row builder (new table columns)
		function addExercise(ex = {})
		{
			const table = document.getElementById("workoutTable");
			const row = table.insertRow(-1);

			//	defaults
			const unit = ex.unit || settings.defaultUnit;
			const name = ex.name || "";
			const sets = ex.sets || 3;
			const reps = ex.reps ?? 10;
			const difficulty = ex.difficulty || 5;
			const notes = ex.notes || "";
			const dropset = !!ex.dropset;

			row.innerHTML = `
				<td class="exercise-cell">
					<input type="text" placeholder="Exercise" value="${escapeHtml(name)}">
				</td>
				<td class="sets-cell">
					<input type="number" min="1" value="${sets}">
				</td>
				<td class="reps-cell">
					<input type="number" min="1" value="${reps}">
				</td>
				<td class="weight-cell">
					<div class="weight-line">
						<input type="number" min="0" class="single-weight" value="${dropset ? '' : (Array.isArray(ex.weights) ? (ex.weights[0] ?? 0) : (ex.weight ?? 0))}">
						<select class="unit-select">
							<option value="kg" ${unit==='kg'?'selected':''}>kg</option>
							<option value="lbs" ${unit==='lbs'?'selected':''}>lbs</option>
						</select>
						<label style="font-size:13px;">
							<input type="checkbox" class="dropset-checkbox" ${dropset ? 'checked' : ''}>
							dropset
						</label>
					</div>
					<div class="dropset-inputs" style="display:${dropset ? '' : 'none'};"></div>
				</td>
				<td class="difficulty-cell">
					<input type="range" min="1" max="10" value="${difficulty}" class="difficulty-slider">
					<span class="difficulty-value">${difficulty}</span>
				</td>
				<td class="notes-cell">
					<input type="text" placeholder="Notes" value="${escapeHtml(notes)}">
				</td>
				<td class="remove-col"></td>
			`;

			//	remove button
			const removeCell = row.querySelector('.remove-col');
			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.textContent = 'X';
			removeBtn.addEventListener('click', () => removeRow(removeBtn));
			removeCell.appendChild(removeBtn);

			addRowListeners(row);

			if (dropset)
			{
				toggleDropSet(row.querySelector('.dropset-checkbox'), Array.isArray(ex.weights) ? ex.weights : []);
			}
		}

		function addBreak(br = {})
		{
			const table = document.getElementById("workoutTable");
			const row = table.insertRow(-1);
			row.className = "break-row";

			const duration = br.duration || 60;

			row.innerHTML = `
				<td colspan="3" style="font-style:italic;">
					Break
				</td>
				<td style="text-align:left;">
					<input type="number" min="1" value="${duration}"> sec
				</td>
				<td colspan="2"></td>
				<td class="remove-col"></td>
			`;

			row.dataset.plannedDuration = duration;

			const removeCell = row.querySelector('.remove-col');
			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.textContent = 'X';
			removeBtn.addEventListener('click', () => removeRow(removeBtn));
			removeCell.appendChild(removeBtn);
		}

		//	Timers
		function startRowTimer(index)
		{
			const rows = Array.from(document.getElementById("workoutTable").rows).slice(1);
			if (index < 0 || index >= rows.length) return;

			if (activeRowIndex !== null && activeRowIndex !== index)
			{
				stopRowTimer(activeRowIndex);
			}

			const row = rows[index];

			//	provide a time-display element on the row (stored in dataset)
			if (!row.querySelector('.time-display'))
			{
				const td = document.createElement('td');
				td.style.display = 'none';	// hidden because layout doesn't show time column, but time is tracked.
				td.className = 'time-cell';
				td.innerHTML = `<span class="time-display" data-seconds="${row.dataset._time || 0}">${formatTime(row.dataset._time || 0)}</span>`;
				row.appendChild(td);
			}

			const display = row.querySelector('.time-display');
			if (!display) return;

			let elapsed = parseInt(display.dataset.seconds || "0");
			if (rowTimers[index]) clearInterval(rowTimers[index]);

			rowTimers[index] = setInterval(() =>
			{
				elapsed++;
				display.dataset.seconds = elapsed;
				display.textContent = formatTime(elapsed);
			}, 1000);

			activeRowIndex = index;
		}

		function stopRowTimer(index)
		{
			if (rowTimers[index])
			{
				clearInterval(rowTimers[index]);
				rowTimers[index] = null;
			}
			if (activeRowIndex === index) activeRowIndex = null;
		}

		function computeTotalFromRows()
		{
			const rows = Array.from(document.getElementById("workoutTable").rows).slice(1);
			return rows.reduce((sum, r) => sum + (parseInt(r.querySelector('.time-display')?.dataset.seconds || '0') || 0), 0);
		}

		//	Global workout timer
		function startWorkoutTimer()
		{
			const display = document.getElementById("workoutTotalTimer");
			workoutSeconds = 0;
			if (workoutTimer) clearInterval(workoutTimer);
			workoutTimer = setInterval(() =>
			{
				workoutSeconds++;
				display.textContent = "Total Time: " + formatTime(workoutSeconds);
			}, 1000);
		}

		function stopWorkoutTimer()
		{
			if (workoutTimer)
			{
				clearInterval(workoutTimer);
				workoutTimer = null;
			}
		}

		function startWorkout()
		{
			const btn = document.getElementById("startWorkoutBtn");
			const table = document.getElementById("workoutTable");
			const rows = Array.from(table.rows).slice(1);

			if (btn.dataset.active === "true")
			{
				//	End workout
				endWorkout();
				btn.textContent = "Start";
				btn.dataset.active = "false";
				return;
			}

			//	Start workout
			if (!rows.length)
			{
				alert("Add at least one row first.");
				return;
			}

			const timerDisplay = document.getElementById("workoutTotalTimer");
			timerDisplay.style.display = "block";
			timerDisplay.textContent = "Total Time: 00:00";

			workoutStarted = true;

			//	start first stopwatch
			startRowTimer(0);

			//	if first is break, start its countdown
			if (rows[0].classList.contains("break-row"))
			{
				startBreakCountdown(rows[0]);
			}

			startWorkoutTimer();

			btn.textContent = "End";
			btn.dataset.active = "true";
		}

		function endWorkout()
		{
			// stop all row stopwatches
			rowTimers.forEach((id, idx) =>
			{
				if (id) clearInterval(id);
				rowTimers[idx] = null;
			});
			activeRowIndex = null;

			// stop global timer
			stopWorkoutTimer();

			// stop break countdowns
			const table = document.getElementById("workoutTable");
			const rows = Array.from(table.rows).slice(1);
			rows.forEach(r =>
			{
				if (r._countdown)
				{
					clearInterval(r._countdown);
					r._countdown = null;
				}
				r.classList.remove("flash-bg");
			});

			// keep workoutStarted true until saved; this preserves session time capture
		}

		//	Break countdown
		function startBreakCountdown(breakRow)
		{
			const cell = breakRow.querySelector('td:nth-child(4)');
			const input = breakRow.querySelector('input');

			let planned = input ? (parseInt(input.value) || 0) : (parseInt(breakRow.dataset.plannedDuration) || 0);
			if (!planned) planned = 60;
			breakRow.dataset.plannedDuration = planned;

			// replace inner of that td with countdown UI
			cell.innerHTML = '';

			let timeLeft = planned;
			const display = document.createElement("span");
			display.className = "break-countdown";
			cell.appendChild(display);

			const btnAdd = document.createElement("button");
			btnAdd.type = 'button';
			btnAdd.textContent = "+10s";

			const btnSub = document.createElement("button");
			btnSub.type = 'button';
			btnSub.textContent = "-10s";

			const btnReset = document.createElement("button");
			btnReset.type = 'button';
			btnReset.textContent = "Reset";

			const btnSkip = document.createElement("button");
			btnSkip.type = 'button';
			btnSkip.textContent = "Skip";

			// style the small buttons to be compact in the td
			btnAdd.style.padding = "6px 8px";
			btnSub.style.padding = "6px 8px";
			btnReset.style.padding = "6px 8px";
			btnSkip.style.padding = "6px 8px";
			btnAdd.style.marginLeft = "6px";

			cell.appendChild(btnAdd);
			cell.appendChild(btnSub);
			cell.appendChild(btnReset);
			cell.appendChild(btnSkip);

			function updateDisplay()
			{
				if (timeLeft <= 0)
				{
					display.textContent = "Break complete!";
					breakRow.classList.remove("flash-bg");
					breakRow.classList.add("break-done");

					if (breakRow._countdown)
					{
						clearInterval(breakRow._countdown);
						breakRow._countdown = null;
					}

					// move to next row's stopwatch
					const rows = Array.from(document.getElementById("workoutTable").rows).slice(1);
					const idx = rows.indexOf(breakRow);
					stopRowTimer(idx);
					if (idx + 1 < rows.length)
					{
						startRowTimer(idx + 1);
						const nextRow = rows[idx + 1];
						if (nextRow.classList.contains("break-row"))
						{
							startBreakCountdown(nextRow);
						}
					}
				}
				else
				{
					display.textContent = `Break: ${timeLeft}s`;
					if (timeLeft <= 10)
					{
						breakRow.classList.add("flash-bg");
					}
					else
					{
						breakRow.classList.remove("flash-bg");
					}
				}
			}

			function restartCountdown()
			{
				if (timeLeft > 0 && !breakRow._countdown)
				{
					breakRow._countdown = setInterval(() =>
					{
						timeLeft--;
						updateDisplay();
					}, 1000);
				}
			}

			function clearCompleteState()
			{
				breakRow.classList.remove("break-done");
			}

			btnAdd.addEventListener('click', () =>
			{
				timeLeft += 10;
				clearCompleteState();
				updateDisplay();
				restartCountdown();
			});
			btnSub.addEventListener('click', () =>
			{
				timeLeft = Math.max(0, timeLeft - 10);
				clearCompleteState();
				updateDisplay();
				restartCountdown();
			});
			btnReset.addEventListener('click', () =>
			{
				timeLeft = planned;
				clearCompleteState();
				updateDisplay();
				restartCountdown();
			});
			btnSkip.addEventListener('click', () =>
			{
				timeLeft = 0;
				updateDisplay();
			});

			updateDisplay();
			restartCountdown();
		}

		//	Completing a row -- in this simplified mobile layout we use explicit controls only
		function completeRow(row)
		{
			const table = document.getElementById("workoutTable");
			const rows = Array.from(table.rows).slice(1);
			const idx = rows.indexOf(row);

			row.classList.add("exercise-done");

			if (row.classList.contains("break-row"))
			{
				if (row._countdown)
				{
					clearInterval(row._countdown);
					row._countdown = null;
				}
				row.classList.remove("flash-bg");
				row.classList.add("break-done");
			}

			stopRowTimer(idx);

			if (idx + 1 < rows.length)
			{
				const nextRow = rows[idx + 1];
				startRowTimer(idx + 1);
				if (nextRow.classList.contains("break-row"))
				{
					startBreakCountdown(nextRow);
				}
			}
			else
			{
				endWorkout();
				const btn = document.getElementById("startWorkoutBtn");
				btn.textContent = "Start";
				btn.dataset.active = "false";
			}
		}

		//	Row listeners & dropset handling
		function addRowListeners(row)
		{
			const repsNumber = row.querySelector('.reps-cell input[type="number"]');
			const dropsetCb = row.querySelector('.dropset-checkbox');
			const slider = row.querySelector('.difficulty-slider');
			const sliderValue = row.querySelector('.difficulty-value');

			if (repsNumber)
			{
				repsNumber.addEventListener('input', () => updateDropSetInputs(repsNumber));
			}
			if (dropsetCb)
			{
				dropsetCb.addEventListener('change', (e) => toggleDropSet(e.target));
			}
			if (slider && sliderValue)
			{
				slider.addEventListener('input', () =>
				{
					sliderValue.textContent = slider.value;
				});
			}
		}

		function toggleDropSet(checkbox, restoreValues = [])
		{
			const row = checkbox.closest('tr');
			const dropsetContainer = row.querySelector('.dropset-inputs');
			const singleWeight = row.querySelector('.single-weight');
			const repsInput = row.querySelector('.reps-cell input[type="number"]');
			if (dropsetContainer) dropsetContainer.innerHTML = '';

			if (checkbox.checked)
			{
				if (dropsetContainer) dropsetContainer.style.display = '';
				if (singleWeight) singleWeight.style.display = 'none';
				const count = Math.max(1, parseInt(repsInput?.value) || 1);
				for (let i = 0; i < count; i++)
				{
					const w = document.createElement('input');
					w.type = 'number';
					w.min = '0';
					w.value = restoreValues[i] != null ? restoreValues[i] : (i === 0 && singleWeight && singleWeight.value ? singleWeight.value : 0);
					if (dropsetContainer) dropsetContainer.appendChild(w);
				}
			}
			else
			{
				if (dropsetContainer) dropsetContainer.style.display = 'none';
				if (dropsetContainer) dropsetContainer.innerHTML = '';
				if (singleWeight) singleWeight.style.display = '';
				if (restoreValues.length && singleWeight) singleWeight.value = restoreValues[0];
			}
		}

		function updateDropSetInputs(repsInput)
		{
			const row = repsInput.closest('tr');
			const dropsetCb = row.querySelector('.dropset-checkbox');
			if (!dropsetCb || !dropsetCb.checked) return;
			const container = row.querySelector('.dropset-inputs');
			const current = Array.from(container.querySelectorAll('input'));
			const newCount = Math.max(1, parseInt(repsInput.value) || 1);
			if (current.length < newCount)
			{
				const lastVal = current.length ? current[current.length - 1].value : 0;
				for (let i = current.length; i < newCount; i++)
				{
					const w = document.createElement('input');
					w.type = 'number';
					w.min = '0';
					w.value = lastVal || 0;
					container.appendChild(w);
				}
			}
			else if (current.length > newCount)
			{
				for (let i = current.length - 1; i >= newCount; i--)
				{
					container.removeChild(current[i]);
				}
			}
		}

		function removeRow(button)
		{
			button.closest('tr').remove();
		}

		//	Save / Edit / Delete / Cancel
		function saveWorkout()
		{
			endWorkout();

			const table = document.getElementById("workoutTable");
			const rows = Array.from(table.rows).slice(1);
			if (!rows.length)
			{
				alert("Add at least one exercise!");
				return;
			}

			const exercises = rows.map(row =>
			{
				const timeSecs = parseInt(row.querySelector(".time-display")?.dataset.seconds || "0");
				if (row.classList.contains("break-row"))
				{
					const input = row.querySelector('input');
					const planned = input ? (parseInt(input.value) || 0) : (parseInt(row.dataset.plannedDuration) || 0);
					return { type: "break", duration: planned, time: timeSecs };
				}
				const nameInput = row.querySelector('.exercise-cell input');
				const setsInput = row.querySelector('.sets-cell input');
				const repsInput = row.querySelector('.reps-cell input[type="number"]');
				const dropsetCheckbox = row.querySelector('.dropset-checkbox');
				const unitSelect = row.querySelector('.unit-select');
				const notesInput = row.querySelector('.notes-cell input');
				const slider = row.querySelector('.difficulty-slider');

				let weights = [];
				if (dropsetCheckbox && dropsetCheckbox.checked)
				{
					weights = Array.from(row.querySelectorAll('.dropset-inputs input')).map(i => i.value || 0);
				}
				else
				{
					const singleWeight = row.querySelector('.single-weight')?.value || 0;
					weights = [singleWeight];
				}

				return {
					type: "exercise",
					name: nameInput?.value || "",
					sets: setsInput?.value || 0,
					reps: repsInput?.value || 0,
					weights,
					unit: unitSelect?.value || settings.defaultUnit,
					dropset: dropsetCheckbox?.checked || false,
					difficulty: slider?.value || 0,
					notes: notesInput?.value || "",
					time: timeSecs
				};
			});

			let totalTime = 0;
			if (workoutStarted)
			{
				totalTime = (workoutSeconds && workoutSeconds > 0)
					? workoutSeconds
					: exercises.reduce((s, ex) => s + (parseInt(ex.time) || 0), 0);
			}

			if (editIndex !== null)
			{
				workouts[editIndex].exercises = exercises;
				workouts[editIndex].date = new Date().toLocaleString();
				workouts[editIndex].totalTime = totalTime;
				editIndex = null;
				document.getElementById("cancelEditBtn").style.display = "none";
			}
			else
			{
				workouts.push({ date: new Date().toLocaleString(), exercises, totalTime });
			}

			localStorage.setItem("workouts", JSON.stringify(workouts));
			renderHistory();
			updateExerciseSelector();
			renderProgress();

			//	reset table to header only
			table.innerHTML = table.rows[0].outerHTML;

			//	reset start button and timers
			const btn = document.getElementById("startWorkoutBtn");
			btn.textContent = "Start";
			btn.dataset.active = "false";

			document.getElementById("workoutTotalTimer").style.display = "none";

			workoutStarted = false;
			workoutSeconds = 0;
		}

		function editWorkout(index)
		{
			const table = document.getElementById("workoutTable");
			table.innerHTML = table.rows[0].outerHTML;
			const w = workouts[index];
			(w.exercises || []).forEach(ex =>
			{
				if (ex.type === "break") addBreak(ex);
				else addExercise(ex);
			});
			editIndex = index;
			document.getElementById("cancelEditBtn").style.display = "inline-block";

			const timerDisplay = document.getElementById("workoutTotalTimer");
			timerDisplay.style.display = "block";
			timerDisplay.textContent = "Total Time: " + formatTime(w.totalTime || 0);
		}

		function deleteWorkout(index)
		{
			if (!confirm("Are you sure you want to delete this workout?")) return;
			workouts.splice(index, 1);
			localStorage.setItem("workouts", JSON.stringify(workouts));
			renderHistory();
			updateExerciseSelector();
			renderProgress();
		}

		function cancelEdit()
		{
			editIndex = null;
			document.getElementById("cancelEditBtn").style.display = "none";
			document.getElementById("workoutTable").innerHTML = document.getElementById("workoutTable").rows[0].outerHTML;
			document.getElementById("workoutTotalTimer").style.display = "none";
			workoutStarted = false;
		}

		//	History & Progress rendering
		function renderHistory()
		{
			const historyDiv = document.getElementById("history");
			historyDiv.innerHTML = "";

			workouts.slice().reverse().forEach((workout, i) =>
			{
				const actualIndex = workouts.length - 1 - i;
				const div = document.createElement("div");
				div.className = "workout-entry";
				const strong = document.createElement("strong");
				strong.textContent = workout.date;
				const span = document.createElement("span");
				span.textContent = " Total Time: " + formatTime(workout.totalTime || 0);

				const editBtn = document.createElement("button");
				editBtn.type = 'button';
				editBtn.textContent = 'Edit';
				editBtn.addEventListener('click', () => editWorkout(actualIndex));

				const delBtn = document.createElement("button");
				delBtn.type = 'button';
				delBtn.textContent = 'Delete';
				delBtn.addEventListener('click', () => deleteWorkout(actualIndex));

				const table = document.createElement("table");
				table.className = "history-table";
				const thead = document.createElement("tr");
				thead.innerHTML = `
					<th>Time</th>
					<th>Exercise</th>
					<th>Sets x Reps</th>
					<th>Weight</th>
					<th>Difficulty</th>
					<th>Notes</th>
				`;
				table.appendChild(thead);

				(workout.exercises || []).forEach(ex =>
				{
					const tr = document.createElement("tr");
					if (ex.type === "break")
					{
						tr.innerHTML = `
							<td>${formatTime(ex.time || 0)}</td>
							<td colspan="4" style="text-align:center; font-style:italic;">Break: ${ex.duration || 0} sec</td>
						`;
					}
					else
					{
						const repsDisplay = `${ex.sets}x${ex.reps}`;
						const weightsDisplay = ex.dropset ? `${ex.weights.join(' → ')} ${ex.unit}` : `${ex.weights[0]} ${ex.unit}`;
						const dsTag = ex.dropset ? ' (dropset)' : '';
						const note = ex.notes || '';
						const difficultyDisplay = (ex.difficulty != null ? ex.difficulty : '—');
						tr.innerHTML = `
							<td>${formatTime(ex.time || 0)}</td>
							<td>${escapeHtml(ex.name)}</td>
							<td>${repsDisplay}</td>
							<td>${weightsDisplay}${dsTag}</td>
							<td>${difficultyDisplay}/10</td>
							<td>${escapeHtml(note)}</td>
						`;
					}
					table.appendChild(tr);
				});

				div.appendChild(strong);
				div.appendChild(span);
				div.appendChild(editBtn);
				div.appendChild(delBtn);
				const wrap = document.createElement('div');
				wrap.className = 'table-wrapper';
				wrap.appendChild(table);
				div.appendChild(wrap);
				historyDiv.appendChild(div);
			});
		}

		function updateExerciseSelector()
		{
			const select = document.getElementById("exerciseSelect");
			if (!select) return;
			const names = new Set();
			workouts.forEach(w =>
			{
				(w.exercises || []).forEach(ex =>
				{
					if (ex.type === "exercise" && ex.name && ex.name.trim()) names.add(ex.name.trim());
				});
			});
			const current = select.value || "__all";
			select.innerHTML = "";
			const allOpt = document.createElement('option');
			allOpt.value = "__all";
			allOpt.textContent = "All exercises";
			select.appendChild(allOpt);
			Array.from(names).sort().forEach(n =>
			{
				const o = document.createElement('option');
				o.value = n;
				o.textContent = n;
				select.appendChild(o);
			});
			select.value = Array.from(select.querySelectorAll('option')).some(o => o.value === current) ? current : "__all";
		}

		function chartColors()
		{
			return settings.appearance === 'dark'
				? { grid: '#555', tick: '#ccc', legend: '#ddd' }
				: { grid: '#ddd', tick: '#333', legend: '#111' };
		}

		function renderProgress()
		{
			updateExerciseSelector();
			const selected = document.getElementById("exerciseSelect")?.value || "__all";

			let labels = [];
			let difficultyData = [];
			let weightData = [];

			if (selected === "__all")
			{
				labels = workouts.map(w => w.date);
				difficultyData = workouts.map(w =>
				{
					const exs = (w.exercises || []).filter(e => e.type !== "break");
					if (!exs.length) return 0;
					const total = exs.reduce((sum, ex) => sum + (parseFloat(ex.difficulty || 0)), 0);
					return total / exs.length;
				});
				weightData = workouts.map(w =>
				{
					return (w.exercises || []).filter(e => e.type !== "break").reduce((sum, ex) =>
					{
						const weightPerSet = (Array.isArray(ex.weights) ? ex.weights : [ex.weights]).reduce((a,b) => a + toDefaultUnit(b, ex.unit), 0);
						return sum + weightPerSet * parseInt(ex.sets || 1);
					}, 0);
				});
			}
			else
			{
				workouts.forEach(w =>
				{
					const matches = (w.exercises || []).filter(ex => ex.type !== "break" && ex.name && ex.name.trim() === selected);
					if (!matches.length) return;
					labels.push(w.date);
					const avgDiff = matches.reduce((s, ex) => s + (parseFloat(ex.difficulty || 0)), 0) / matches.length;
					difficultyData.push(avgDiff);
					const totalW = matches.reduce((s, ex) =>
					{
						const weightPerSet = (Array.isArray(ex.weights) ? ex.weights : [ex.weights]).reduce((a,b) => a + toDefaultUnit(b, ex.unit), 0);
						return s + weightPerSet * parseInt(ex.sets || 1);
					}, 0);
					weightData.push(totalW);
				});
			}

			if (!labels.length)
			{
				labels = ['No data'];
				difficultyData = [0];
				weightData = [0];
			}

			if (difficultyChart) difficultyChart.destroy();
			if (weightChart) weightChart.destroy();

			const colors = chartColors();

			const ctx1 = document.getElementById("difficultyChart").getContext("2d");
			difficultyChart = new Chart(ctx1, {
				type: "line",
				data: {
					labels: labels,
					datasets: [{
						label: selected === "__all" ? "Avg Difficulty (all exercises)" : `Avg Difficulty — ${selected}`,
						data: difficultyData,
						borderColor: "rgb(38, 115, 255)",
						backgroundColor: "rgba(38,115,255,0.1)",
						fill: true,
						tension: 0.2,
						pointRadius: 4
					}]
				},
				options: {
					responsive: true,
					scales: {
						x: { display: false, grid: { drawTicks: false, drawBorder: false } },
						y: { suggestedMin: 0, suggestedMax: 10, grid: { color: colors.grid }, ticks: { color: colors.tick } }
					},
					plugins: {
						legend: { labels: { color: colors.legend } },
						tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } }
					}
				}
			});

			const ctx2 = document.getElementById("weightChart").getContext("2d");
			weightChart = new Chart(ctx2, {
				type: "line",
				data: {
					labels: labels,
					datasets: [{
						label: selected === "__all" ? `Total Weight Lifted (${settings.defaultUnit})` : `Total Weight — ${selected} (${settings.defaultUnit})`,
						data: weightData,
						borderColor: "rgb(34, 197, 94)",
						backgroundColor: "rgba(34,197,94,0.1)",
						fill: true,
						tension: 0.2,
						pointRadius: 4
					}]
				},
				options: {
					responsive: true,
					scales: {
						x: { display: false, grid: { drawTicks: false, drawBorder: false } },
						y: { grid: { color: colors.grid }, ticks: { color: colors.tick } }
					},
					plugins: {
						legend: { labels: { color: colors.legend } },
						tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } }
					}
				}
			});
		}

		//	Initial render & event wiring
		renderHistory();
		updateExerciseSelector();
		renderProgress();

		// wire buttons
		document.getElementById('addExerciseBtn').addEventListener('click', () => addExercise());
		document.getElementById('addBreakBtn').addEventListener('click', () => addBreak());
		document.getElementById('saveWorkoutBtn').addEventListener('click', saveWorkout);
		document.getElementById('startWorkoutBtn').addEventListener('click', startWorkout);
		document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
		document.getElementById('settingsBtn').addEventListener('click', openSettings);

		// modal buttons
		document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
		document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);

		document.getElementById('exerciseSelect').addEventListener('change', renderProgress);

		// small helper to escape html inserted into innerHTML
		function escapeHtml(str)
		{
			if (str == null) return '';
			return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		}

		// expose some helpers for debugging (optional)
		window.__wt = {
			addExercise,
			addBreak,
			saveWorkout,
			renderHistory,
			renderProgress
		};