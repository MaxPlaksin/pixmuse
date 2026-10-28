#target photoshop
/*
  Пилот / пакет: CR3/JPEG → только экшен Лизы → PSD в _after_button/.
  Оригиналы на диске не перезаписываются (close без save).

  НЕ запускать ElizCatalogColorStack.jsx после экшена — дублирует «цвет тела» и «фон».
*/

(function () {
  // ==== НАСТРОЙКА (заполнить перед пилотом) ====
  var ACTION_SET = "Default Actions";
  var ACTION_NAME = "ElizColorButton";
  var SAVE_PSD = true;

  /** Пилот: true = не больше PILOT_MAX файлов, подтверждение, лог */
  var PILOT_MODE = true;
  var PILOT_MAX = 5;

  /** girl1 | girl2 — для girl2 нужно подтверждение (другой пресет кнопки) */
  var MODEL_PROFILE = "girl1";

  /** true = остановиться на первой ошибке */
  var STOP_ON_ERROR = false;
  // =============================================

  if (ACTION_NAME === "ElizColorButton" || ACTION_SET === "Default Actions") {
    if (
      !confirm(
        "ACTION_SET / ACTION_NAME ещё заглушки.\n\n" +
          "Пропиши имена из панели «Операции» Лизы.\n\n" +
          "Всё равно продолжить?"
      )
    ) {
      return;
    }
  }

  if (MODEL_PROFILE === "girl2") {
    if (
      !confirm(
        "Профиль girl2: не применяй пресет девочки 1 без отдельного PSB/экшена.\n\n" +
          "Продолжить только если кнопка уже для второй модели?"
      )
    ) {
      return;
    }
  }

  var folder = Folder.selectDialog("Папка с исходниками (только CR3/JPEG, не вся съёмка)");
  if (!folder) return;

  var outFolder = new Folder(folder.fsName + "/_after_button");
  if (!outFolder.exists) outFolder.create();

  var logFile = new File(outFolder.fsName + "/batch.log");
  logFile.open("a");
  logFile.writeln("=== " + new Date().toString() + " ===");
  logFile.writeln("PILOT=" + PILOT_MODE + " MODEL=" + MODEL_PROFILE);
  logFile.writeln("Action: " + ACTION_SET + " / " + ACTION_NAME);

  var exts = /\.(cr3|cr2|nef|arw|dng|jpg|jpeg|tif|tiff)$/i;
  var skipDir = /\/_after_button(\/|$)/i;
  var all = folder.getFiles(function (f) {
    if (!(f instanceof File)) return false;
    if (skipDir.test(f.fsName)) return false;
    return f.name.match(exts);
  });

  if (!all.length) {
    alert("В папке нет CR3/JPEG (верхний уровень, без _after_button).");
    logFile.close();
    return;
  }

  all.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  var limit = PILOT_MODE ? Math.min(PILOT_MAX, all.length) : all.length;
  if (PILOT_MODE && all.length > PILOT_MAX) {
    if (
      !confirm(
        "Пилот: обработаю только " +
          PILOT_MAX +
          " из " +
          all.length +
          " файлов.\n\nПродолжить?"
      )
    ) {
      logFile.close();
      return;
    }
  }

  var ok = 0,
    fail = 0,
    log = "";
  var oldDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;

  for (var i = 0; i < limit; i++) {
    var f = all[i];
    var base = f.name.replace(/\.[^.]+$/, "");
    var psdFile = new File(outFolder.fsName + "/" + base + ".psd");

    if (psdFile.exists) {
      log += base + ": SKIP (уже есть " + psdFile.name + ")\n";
      logFile.writeln("SKIP " + f.name);
      continue;
    }

    try {
      open(f);
      var doc = app.activeDocument;
      app.doAction(ACTION_NAME, ACTION_SET);

      if (SAVE_PSD) {
        var psdOpts = new PhotoshopSaveOptions();
        psdOpts.layers = true;
        psdOpts.embedColorProfile = true;
        doc.saveAs(psdFile, psdOpts, true, Extension.LOWERCASE);
      }

      doc.close(SaveOptions.DONOTSAVECHANGES);
      ok++;
      logFile.writeln("OK " + f.name + " -> " + psdFile.name);
    } catch (e) {
      fail++;
      var msg = f.name + ": " + e.message;
      log += msg + "\n";
      logFile.writeln("FAIL " + msg);
      try {
        if (app.documents.length) {
          app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
      } catch (e2) {}
      if (STOP_ON_ERROR) {
        log += "\nОстановка по STOP_ON_ERROR.\n";
        break;
      }
    }
  }

  app.displayDialogs = oldDialogs;
  logFile.writeln("OK=" + ok + " FAIL=" + fail);
  logFile.close();

  alert(
    (PILOT_MODE ? "Пилот завершён.\n" : "Пакет завершён.\n") +
      "Успешно: " +
      ok +
      "\nОшибок: " +
      fail +
      "\nПапка: " +
      outFolder.fsName +
      "\nЛог: batch.log" +
      (log ? "\n\n" + log : "")
  );
})();
