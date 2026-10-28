#target photoshop
/*
  Частотное разделение (радиус 7) после слияния слоёв кнопки.
  Оригинальный слой не изменяется — только дубликаты; фильтры только на копиях.

  High + Low (группа 100%, Linear Light 100%) ≈ исходник:
  - 16 bit: Apply Image Add, Invert, Scale 2, Offset 0
  - 8 bit:  Apply Image Subtract, Scale 2, Offset 128
*/

(function () {
  var RADIUS = 7;
  var GROUP_NAME = "частотка";
  var HIGH_OPACITY = 100;
  var SRC_LABEL = "исходник (сравнение)";

  var LOG = new File("/tmp/eliz_frequency.log");

  function log(msg) {
    try {
      LOG.open("a");
      LOG.writeln(new Date() + " " + msg);
      LOG.close();
    } catch (e) {}
  }

  if (!app.documents.length) {
    alert("Откройте фото.");
    return;
  }

  var doc = app.activeDocument;
  log("doc=" + doc.name);

  var modeOk = validateDocumentMode(doc);
  if (!modeOk.ok) {
    alert(modeOk.message);
    return;
  }

  var depth = getBitDepth(doc);
  if (depth === 32) {
    alert(
      "32-bit на документ не поддерживается этим сценарием.\n" +
        "Image → Mode → 16 Bits/Channel (или 8), затем повторите."
    );
    return;
  }
  if (depth !== 8 && depth !== 16) {
    alert("Не удалось определить глубину (8/16 bit). Проверьте Image → Mode.");
    return;
  }

  var src = doc.activeLayer;
  log("active=" + src.name + " bg=" + src.isBackgroundLayer);

  if (src.isBackgroundLayer) {
    alert(
      "Сведите слои в один или продублируйте фон в обычный слой и выделите его."
    );
    return;
  }

  if (src.typename === "LayerSet") {
    alert("Выделите один пиксельный слой (не группу).");
    return;
  }

  var quiet = $.global.ELIZ_QUIET === true;

  try {
    var low = src.duplicate();
    low.name = "Low (blur " + RADIUS + ")";
    doc.activeLayer = low;
    gaussianBlur(RADIUS);

    var high = src.duplicate();
    high.name = "High (texture)";
    doc.activeLayer = high;
    low.visible = true;

    if (depth === 16) {
      applyImageFromLayer(low, "addInvert");
    } else {
      applyImageFromLayer(low, "subtract8");
    }

    high.blendMode = BlendMode.LINEARLIGHT;
    high.opacity = HIGH_OPACITY;

    var grp = doc.layerSets.add();
    grp.name = GROUP_NAME;
    low.move(grp, ElementPlacement.INSIDE);
    high.move(grp, ElementPlacement.INSIDE);

    try {
      revealAllMask(grp);
    } catch (maskErr) {
      log("mask skip: " + maskErr.message);
    }

    src.visible = false;
    grp.visible = true;

    if (src.name !== SRC_LABEL) {
      src.name = SRC_LABEL;
    }
    log("OK depth=" + depth + " sets=" + doc.layerSets.length);
  } catch (e) {
    log("FAIL " + e.message + " line " + e.line + " #" + e.number);
    if (!quiet) {
      alert(
        "Частотка: ошибка\n" +
          e.message +
          "\n\nСм. /tmp/eliz_frequency.log"
      );
    }
    throw e;
  }

  if (!quiet) {
    alert(
      "Группа «" +
        GROUP_NAME +
        "» (" +
        depth +
        "-bit, blur " +
        RADIUS +
        ", Linear Light " +
        HIGH_OPACITY +
        "%).\n\n" +
        "Тест 2: группа on/off vs слой «" +
        SRC_LABEL +
        "».\n\n" +
        "Оригинал не менялся — только копии."
    );
  }

  function validateDocumentMode(d) {
    var m = d.mode;
    if (m === DocumentMode.RGB) {
      return { ok: true };
    }
    if (m === DocumentMode.CMYK) {
      return {
        ok: false,
        message:
          "Режим CMYK. Для частотки как у Лизы: Image → Mode → RGB, затем снова сценарий.",
      };
    }
    if (m === DocumentMode.GRAYSCALE) {
      return {
        ok: false,
        message: "Grayscale не поддерживается — нужен RGB.",
      };
    }
    if (m === DocumentMode.INDEXEDCOLOR || m === DocumentMode.BITMAP) {
      return {
        ok: false,
        message: "Indexed/Bitmap — переведите в RGB (8 или 16 bit).",
      };
    }
    return {
      ok: false,
      message:
        "Режим документа не RGB (текущий: " +
        modeToString(m) +
        "). Переключите в RGB.",
    };
  }

  function modeToString(m) {
    try {
      return m.toString();
    } catch (e) {
      return "?";
    }
  }

  function getBitDepth(d) {
    var b = d.bitsPerChannel;
    if (b === BitsPerChannelType.SIXTEEN) return 16;
    if (b === BitsPerChannelType.EIGHT) return 8;
    if (b === BitsPerChannelType.THIRTYTWO) return 32;
    return -1;
  }

  function gaussianBlur(radius) {
    var desc = new ActionDescriptor();
    desc.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), radius);
    executeAction(charIDToTypeID("GsnB"), desc, DialogModes.NO);
  }

  function applyImageFromLayer(lowLayer, mode) {
    var desc = new ActionDescriptor();
    if (mode === "addInvert") {
      desc.putEnumerated(
        charIDToTypeID("With"),
        charIDToTypeID("Wth "),
        charIDToTypeID("Add ")
      );
      desc.putInteger(charIDToTypeID("Opct"), 100);
      desc.putInteger(charIDToTypeID("Scl "), 2);
      desc.putInteger(charIDToTypeID("Ofst"), 0);
      desc.putBoolean(charIDToTypeID("Invr"), true);
    } else {
      desc.putEnumerated(
        charIDToTypeID("With"),
        charIDToTypeID("Wth "),
        charIDToTypeID("Sbtr")
      );
      desc.putInteger(charIDToTypeID("Opct"), 100);
      desc.putInteger(charIDToTypeID("Scl "), 2);
      desc.putInteger(charIDToTypeID("Ofst"), 128);
    }

    var refT = new ActionReference();
    refT.putEnumerated(
      charIDToTypeID("Lyr "),
      charIDToTypeID("Ordn"),
      charIDToTypeID("Trgt")
    );
    desc.putReference(charIDToTypeID("T   "), refT);

    var refS = new ActionReference();
    refS.putIndex(charIDToTypeID("Lyr "), lowLayer.itemIndex);
    desc.putReference(charIDToTypeID("Src "), refS);

    executeAction(charIDToTypeID("AppI"), desc, DialogModes.NO);
  }

  function revealAllMask(layerSet) {
    doc.activeLayer = layerSet;
    var desc = new ActionDescriptor();
    desc.putClass(charIDToTypeID("Nw  "), charIDToTypeID("Chnl"));
    var ref = new ActionReference();
    ref.putEnumerated(
      charIDToTypeID("Chnl"),
      charIDToTypeID("Chnl"),
      charIDToTypeID("Msk ")
    );
    desc.putReference(charIDToTypeID("At  "), ref);
    desc.putEnumerated(
      charIDToTypeID("Usng"),
      charIDToTypeID("UsrM"),
      charIDToTypeID("RvlA")
    );
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
  }
})();
