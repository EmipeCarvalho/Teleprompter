/*
 * mp4remux.js — converte um MP4 "fragmentado" (fMP4: ftyp + moov vazio com
 * mvex + vários moof/mdat) num MP4 "clássico" (ftyp + moov com tabela de
 * amostras completa + mdat), sem recodificar nada.
 *
 * Por que isso existe: o MediaRecorder do Safari/iOS grava em fMP4. O app
 * Fotos do iPhone toca esse formato normalmente, mas muitos editores (CapCut,
 * etc.) só entendem o layout clássico e mostram um quadro congelado.
 *
 * Estratégia: os bytes de mídia (mdat) ficam exatamente onde estão. Só
 * inserimos um moov novo logo depois do ftyp e transformamos o moov antigo
 * e todos os moof em caixas "free" (mesmo tamanho, tipo trocado). Assim os
 * deslocamentos originais mudam por um valor constante (o tamanho do moov
 * novo), e não copiamos os dados de vídeo. Vários mdat num MP4 clássico é
 * permitido pela norma ISO BMFF.
 *
 * Sem dependências. Funciona no navegador (window.remuxFragmentedMp4) e no
 * Node (module.exports) para os testes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.remuxFragmentedMp4 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- leitura ----------

  function str4(u8, off) {
    return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
  }

  function u32(dv, off) {
    return dv.getUint32(off);
  }

  function u64(dv, off) {
    // Cabe em Number para arquivos até 2^53 bytes, mais do que suficiente.
    return dv.getUint32(off) * 4294967296 + dv.getUint32(off + 4);
  }

  // Lê caixas de nível `[start, end)`. Cada item: {type, start, size, hdr}
  // onde hdr é o tamanho do cabeçalho (8, 16 se largesize) e start é o
  // deslocamento absoluto do começo da caixa.
  function readBoxes(dv, u8, start, end) {
    var boxes = [];
    var off = start;
    while (off + 8 <= end) {
      var size = u32(dv, off);
      var type = str4(u8, off + 4);
      var hdr = 8;
      if (size === 1) {
        size = u64(dv, off + 8);
        hdr = 16;
      } else if (size === 0) {
        size = end - off;
      }
      if (size < hdr || off + size > end) {
        throw new Error("caixa inválida " + type + " em " + off);
      }
      boxes.push({ type: type, start: off, size: size, hdr: hdr });
      off += size;
    }
    return boxes;
  }

  function findBox(boxes, type) {
    for (var i = 0; i < boxes.length; i++) if (boxes[i].type === type) return boxes[i];
    return null;
  }

  function children(dv, u8, box) {
    return readBoxes(dv, u8, box.start + box.hdr, box.start + box.size);
  }

  // Alguns "full boxes" começam com version(1)+flags(3).
  function fullBoxVersion(u8, box) {
    return u8[box.start + box.hdr];
  }

  function fullBoxFlags(dv, box) {
    return u32(dv, box.start + box.hdr) & 0xffffff;
  }

  // ---------- escrita ----------

  function box(type, parts) {
    var len = 8;
    for (var i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, len);
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    var off = 8;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], off);
      off += parts[j].length;
    }
    return out;
  }

  function fullBox(type, version, flags, payload) {
    var head = new Uint8Array(4);
    head[0] = version;
    head[1] = (flags >> 16) & 0xff;
    head[2] = (flags >> 8) & 0xff;
    head[3] = flags & 0xff;
    return box(type, [head, payload]);
  }

  function u32array(values) {
    var out = new Uint8Array(values.length * 4);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < values.length; i++) dv.setUint32(i * 4, values[i] >>> 0);
    return out;
  }

  function i32array(values) {
    var out = new Uint8Array(values.length * 4);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < values.length; i++) dv.setInt32(i * 4, values[i] | 0);
    return out;
  }

  function u64array(values) {
    var out = new Uint8Array(values.length * 8);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < values.length; i++) {
      dv.setUint32(i * 8, Math.floor(values[i] / 4294967296));
      dv.setUint32(i * 8 + 4, values[i] >>> 0);
    }
    return out;
  }

  function slice(u8, start, end) {
    return u8.subarray(start, end);
  }

  // ---------- fragmentos → amostras ----------

  var TFHD_BASE_DATA_OFFSET = 0x000001;
  var TFHD_SAMPLE_DESC_INDEX = 0x000002;
  var TFHD_DEFAULT_DURATION = 0x000008;
  var TFHD_DEFAULT_SIZE = 0x000010;
  var TFHD_DEFAULT_FLAGS = 0x000020;
  var TFHD_DEFAULT_BASE_IS_MOOF = 0x020000;

  var TRUN_DATA_OFFSET = 0x000001;
  var TRUN_FIRST_FLAGS = 0x000004;
  var TRUN_DURATION = 0x000100;
  var TRUN_SIZE = 0x000200;
  var TRUN_FLAGS = 0x000400;
  var TRUN_CTS = 0x000800;

  var SAMPLE_IS_NON_SYNC = 0x00010000;

  function parseTrex(dv, u8, mvex) {
    var map = {};
    if (!mvex) return map;
    var kids = children(dv, u8, mvex);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].type !== "trex") continue;
      var p = kids[i].start + kids[i].hdr + 4;
      map[u32(dv, p)] = {
        duration: u32(dv, p + 8),
        size: u32(dv, p + 12),
        flags: u32(dv, p + 16)
      };
    }
    return map;
  }

  // Percorre todos os moof/mdat e acumula, por track_ID, uma lista de
  // "runs" contíguos: {offset, sizes[], durations[], flags[], cts[], dts}.
  function collectSamples(dv, u8, top, trexMap) {
    var tracks = {};
    for (var i = 0; i < top.length; i++) {
      var moof = top[i];
      if (moof.type !== "moof") continue;
      var moofKids = children(dv, u8, moof);
      var prevTrafEnd = moof.start; // para trafs sem base explícita
      for (var k = 0; k < moofKids.length; k++) {
        var traf = moofKids[k];
        if (traf.type !== "traf") continue;
        var trafKids = children(dv, u8, traf);
        var tfhd = findBox(trafKids, "tfhd");
        if (!tfhd) throw new Error("traf sem tfhd");
        var tflags = fullBoxFlags(dv, tfhd);
        var p = tfhd.start + tfhd.hdr + 4;
        var trackId = u32(dv, p);
        p += 4;
        var base = null;
        if (tflags & TFHD_BASE_DATA_OFFSET) {
          base = u64(dv, p);
          p += 8;
        }
        if (tflags & TFHD_SAMPLE_DESC_INDEX) p += 4;
        var trex = trexMap[trackId] || { duration: 0, size: 0, flags: 0 };
        var defDur = trex.duration, defSize = trex.size, defFlags = trex.flags;
        if (tflags & TFHD_DEFAULT_DURATION) {
          defDur = u32(dv, p);
          p += 4;
        }
        if (tflags & TFHD_DEFAULT_SIZE) {
          defSize = u32(dv, p);
          p += 4;
        }
        if (tflags & TFHD_DEFAULT_FLAGS) {
          defFlags = u32(dv, p);
          p += 4;
        }
        if (base === null) {
          base = (tflags & TFHD_DEFAULT_BASE_IS_MOOF) ? moof.start : prevTrafEnd;
        }

        var tfdt = findBox(trafKids, "tfdt");
        var dts = null;
        if (tfdt) {
          var v = fullBoxVersion(u8, tfdt);
          dts = v === 1 ? u64(dv, tfdt.start + tfdt.hdr + 4) : u32(dv, tfdt.start + tfdt.hdr + 4);
        }

        var track = tracks[trackId];
        if (!track) {
          track = tracks[trackId] = { runs: [], firstDts: dts, nextDts: dts === null ? 0 : dts };
        } else if (dts !== null) {
          track.nextDts = dts;
        }

        var cursor = base;
        for (var t = 0; t < trafKids.length; t++) {
          var trun = trafKids[t];
          if (trun.type !== "trun") continue;
          var rflags = fullBoxFlags(dv, trun);
          var rver = fullBoxVersion(u8, trun);
          var q = trun.start + trun.hdr + 4;
          var count = u32(dv, q);
          q += 4;
          if (rflags & TRUN_DATA_OFFSET) {
            cursor = base + dv.getInt32(q);
            q += 4;
          }
          var firstFlags = null;
          if (rflags & TRUN_FIRST_FLAGS) {
            firstFlags = u32(dv, q);
            q += 4;
          }
          var run = { offset: cursor, sizes: [], durations: [], flags: [], cts: [], dts: track.nextDts };
          var total = 0;
          for (var s = 0; s < count; s++) {
            var dur = defDur, size = defSize, fl = defFlags, cts = 0;
            if (rflags & TRUN_DURATION) {
              dur = u32(dv, q);
              q += 4;
            }
            if (rflags & TRUN_SIZE) {
              size = u32(dv, q);
              q += 4;
            }
            if (rflags & TRUN_FLAGS) {
              fl = u32(dv, q);
              q += 4;
            }
            if (rflags & TRUN_CTS) {
              cts = rver === 1 ? dv.getInt32(q) : u32(dv, q);
              q += 4;
            }
            if (s === 0 && firstFlags !== null) fl = firstFlags;
            run.sizes.push(size);
            run.durations.push(dur);
            run.flags.push(fl);
            run.cts.push(cts);
            total += size;
          }
          cursor += total;
          track.nextDts += run.durations.reduce(function (a, b) { return a + b; }, 0);
          if (count > 0) track.runs.push(run);
        }
        prevTrafEnd = cursor;
      }
    }
    return tracks;
  }

  // ---------- construção das tabelas ----------

  function buildStbl(dv, u8, oldStbl, track, isVideo, shift) {
    var kids = children(dv, u8, oldStbl);
    var parts = [];
    var stsd = findBox(kids, "stsd");
    if (!stsd) throw new Error("stbl sem stsd");
    parts.push(slice(u8, stsd.start, stsd.start + stsd.size));

    // stts (run-length de durações)
    var stts = [];
    var lastDur = -1;
    var sizes = [], syncs = [], ctsAll = [], anyCts = false, negCts = false;
    var chunkOffsets = [], chunkCounts = [];
    var sampleIndex = 0;
    for (var r = 0; r < track.runs.length; r++) {
      var run = track.runs[r];
      chunkOffsets.push(run.offset + shift);
      chunkCounts.push(run.sizes.length);
      for (var i = 0; i < run.sizes.length; i++) {
        var d = run.durations[i];
        if (d === lastDur) stts[stts.length - 1] += 1; // count é o elemento anterior
        else {
          stts.push(d, 1);
          lastDur = d;
        }
        // stts armazenado como [dur, count, dur, count...] — ajustamos abaixo
        sizes.push(run.sizes[i]);
        sampleIndex += 1;
        if (!(run.flags[i] & SAMPLE_IS_NON_SYNC)) syncs.push(sampleIndex);
        var c = run.cts[i];
        ctsAll.push(c);
        if (c !== 0) anyCts = true;
        if (c < 0) negCts = true;
      }
    }
    // Reorganiza stts: guardamos [dur,count,...] mas a contagem incrementa o
    // último "count", que é o índice ímpar — a lógica acima usa
    // stts[length-1] que é exatamente o count. Agora converte para
    // [count, dur] pares (ordem da norma: sample_count, sample_delta).
    var sttsEntries = [];
    for (var e = 0; e < stts.length; e += 2) sttsEntries.push(stts[e + 1], stts[e]);
    parts.push(fullBox("stts", 0, 0, u32array([sttsEntries.length / 2].concat(sttsEntries))));

    // ctts
    if (anyCts) {
      var cttsEntries = [];
      var lastC = null;
      for (var ci = 0; ci < ctsAll.length; ci++) {
        if (ctsAll[ci] === lastC) cttsEntries[cttsEntries.length - 2] += 1;
        else {
          cttsEntries.push(1, ctsAll[ci]);
          lastC = ctsAll[ci];
        }
      }
      var cttsPayload = negCts ? i32array([cttsEntries.length / 2].concat(cttsEntries)) : u32array([cttsEntries.length / 2].concat(cttsEntries));
      parts.push(fullBox("ctts", negCts ? 1 : 0, 0, cttsPayload));
    }

    // stss (só vídeo; se todos são sync, omitir = todos são keyframes)
    if (isVideo && syncs.length !== sizes.length) {
      parts.push(fullBox("stss", 0, 0, u32array([syncs.length].concat(syncs))));
    }

    // stsc: uma chunk por run, comprimido por runs iguais consecutivos
    var stscEntries = [];
    var lastCount = -1;
    for (var ch = 0; ch < chunkCounts.length; ch++) {
      if (chunkCounts[ch] !== lastCount) {
        stscEntries.push(ch + 1, chunkCounts[ch], 1);
        lastCount = chunkCounts[ch];
      }
    }
    parts.push(fullBox("stsc", 0, 0, u32array([stscEntries.length / 3].concat(stscEntries))));

    // stsz
    var allSame = sizes.length > 0 && sizes.every(function (s) { return s === sizes[0]; });
    if (allSame) parts.push(fullBox("stsz", 0, 0, u32array([sizes[0], sizes.length])));
    else parts.push(fullBox("stsz", 0, 0, u32array([0, sizes.length].concat(sizes))));

    // stco / co64
    var maxOff = chunkOffsets.length ? Math.max.apply(null, chunkOffsets) : 0;
    if (maxOff < 4294967296) parts.push(fullBox("stco", 0, 0, u32array([chunkOffsets.length].concat(chunkOffsets))));
    else parts.push(fullBox("co64", 0, 0, concat([u32array([chunkOffsets.length]), u64array(chunkOffsets)])));

    // Mantém quaisquer outras caixas do stbl original (sgpd, sbgp, etc.)
    var replaced = { stsd: 1, stts: 1, ctts: 1, stss: 1, stsc: 1, stsz: 1, stz2: 1, stco: 1, co64: 1 };
    for (var k = 0; k < kids.length; k++) {
      if (!replaced[kids[k].type]) parts.push(slice(u8, kids[k].start, kids[k].start + kids[k].size));
    }
    return box("stbl", parts);
  }

  function concat(arrs) {
    var len = 0;
    for (var i = 0; i < arrs.length; i++) len += arrs[i].length;
    var out = new Uint8Array(len);
    var off = 0;
    for (var j = 0; j < arrs.length; j++) {
      out.set(arrs[j], off);
      off += arrs[j].length;
    }
    return out;
  }

  // Copia uma full box (mvhd/tkhd/mdhd) trocando o campo duration.
  function patchDuration(u8, b, durationFieldOffsetV0, durationFieldOffsetV1, duration) {
    var copy = new Uint8Array(u8.subarray(b.start, b.start + b.size));
    var dv = new DataView(copy.buffer);
    var version = copy[b.hdr];
    if (version === 1) {
      var o = b.hdr + durationFieldOffsetV1;
      dv.setUint32(o, Math.floor(duration / 4294967296));
      dv.setUint32(o + 4, duration >>> 0);
    } else {
      dv.setUint32(b.hdr + durationFieldOffsetV0, Math.min(duration, 0xffffffff) >>> 0);
    }
    return copy;
  }

  function trackInfo(dv, u8, trak) {
    var kids = children(dv, u8, trak);
    var tkhd = findBox(kids, "tkhd");
    var mdia = findBox(kids, "mdia");
    if (!tkhd || !mdia) throw new Error("trak incompleto");
    var mkids = children(dv, u8, mdia);
    var mdhd = findBox(mkids, "mdhd");
    var hdlr = findBox(mkids, "hdlr");
    var minf = findBox(mkids, "minf");
    if (!mdhd || !hdlr || !minf) throw new Error("mdia incompleto");
    var tv = fullBoxVersion(u8, tkhd);
    var trackId = tv === 1 ? u32(dv, tkhd.start + tkhd.hdr + 4 + 16) : u32(dv, tkhd.start + tkhd.hdr + 4 + 8);
    var mv = fullBoxVersion(u8, mdhd);
    var timescale = mv === 1 ? u32(dv, mdhd.start + mdhd.hdr + 4 + 16) : u32(dv, mdhd.start + mdhd.hdr + 4 + 8);
    var handler = str4(u8, hdlr.start + hdlr.hdr + 8);
    var minfKids = children(dv, u8, minf);
    var stbl = findBox(minfKids, "stbl");
    if (!stbl) throw new Error("minf sem stbl");
    return { kids: kids, tkhd: tkhd, mdia: mdia, mkids: mkids, mdhd: mdhd, minf: minf, minfKids: minfKids, stbl: stbl, trackId: trackId, timescale: timescale, handler: handler };
  }

  function buildTrak(dv, u8, trak, samples, movieTimescale, shift) {
    var info = trackInfo(dv, u8, trak);
    var track = samples[info.trackId];
    if (!track || track.runs.length === 0) return null; // faixa sem amostras: descarta

    var mediaDuration = 0;
    for (var r = 0; r < track.runs.length; r++) {
      for (var i = 0; i < track.runs[r].durations.length; i++) mediaDuration += track.runs[r].durations[i];
    }
    var firstDts = track.firstDts || 0;
    var presentationDurationMovie = Math.round((mediaDuration * movieTimescale) / info.timescale);
    var delayMovie = Math.round((firstDts * movieTimescale) / info.timescale);
    var isVideo = info.handler === "vide";

    // tkhd: version0 -> creation(4) mod(4) id(4) reserved(4) duration(4) => offset 4+16=20
    //       version1 -> creation(8) mod(8) id(4) reserved(4) duration(8) => offset 4+24=28
    var tkhdNew = patchDuration(u8, info.tkhd, 20, 28, presentationDurationMovie + delayMovie);
    // mdhd: version0 -> creation(4) mod(4) timescale(4) duration(4) => 4+12=16
    //       version1 -> creation(8) mod(8) timescale(4) duration(8) => 4+20=24
    var mdhdNew = patchDuration(u8, info.mdhd, 16, 24, mediaDuration);

    // edts/elst: num MP4 clássico a linha do tempo da mídia começa em 0 no
    // primeiro sample (stts é cumulativo a partir de 0). Se o fMP4 tinha um
    // dts inicial > 0 (a faixa começa depois das outras), isso vira uma
    // "empty edit" que atrasa a apresentação — mantém áudio e vídeo em
    // sincronia. A entrada seguinte usa media_time = cts do primeiro sample:
    // o quadro que era exibido em (dts0 + cts0) continua sendo exibido lá,
    // e o player não procura uma amostra num instante onde não há nenhuma
    // (com media_time 0 e cts0 > 0 o ffmpeg descarta quadros).
    // Sem atraso inicial, não escrevemos elst nenhum: o player começa na
    // primeira amostra exatamente como fazia no fMP4.
    var firstCts = track.runs[0].cts.length ? Math.max(0, track.runs[0].cts[0]) : 0;
    var firstCtsMovie = Math.round((firstCts * movieTimescale) / info.timescale);
    var edts = null;
    if (delayMovie > 0) {
      var elstEntries = [
        delayMovie, 0xffffffff, 0x00010000,
        Math.max(0, presentationDurationMovie - firstCtsMovie), firstCts >>> 0, 0x00010000
      ];
      // Formato v0: segment_duration(u32) media_time(i32) media_rate(u32 16.16)
      var elst = fullBox("elst", 0, 0, u32array([elstEntries.length / 3].concat(elstEntries)));
      edts = box("edts", [elst]);
    }

    // minf reconstruído com stbl novo
    var minfParts = [];
    for (var m = 0; m < info.minfKids.length; m++) {
      var k = info.minfKids[m];
      if (k.type === "stbl") minfParts.push(buildStbl(dv, u8, k, track, isVideo, shift));
      else minfParts.push(slice(u8, k.start, k.start + k.size));
    }
    var minfNew = box("minf", minfParts);

    var mdiaParts = [];
    for (var j = 0; j < info.mkids.length; j++) {
      var mk = info.mkids[j];
      if (mk.type === "mdhd") mdiaParts.push(mdhdNew);
      else if (mk.type === "minf") mdiaParts.push(minfNew);
      else mdiaParts.push(slice(u8, mk.start, mk.start + mk.size));
    }
    var mdiaNew = box("mdia", mdiaParts);

    // Se o arquivo original já traz um edts (ex.: gerado pelo ffmpeg), ele
    // já codifica o atraso da faixa — preservamos e não sintetizamos outro.
    var originalEdts = findBox(info.kids, "edts");
    var trakParts = [];
    var wroteEdts = false;
    for (var t = 0; t < info.kids.length; t++) {
      var tk = info.kids[t];
      if (tk.type === "tkhd") {
        trakParts.push(tkhdNew);
        if (!originalEdts && edts) {
          trakParts.push(edts);
          wroteEdts = true;
        }
      } else if (tk.type === "edts") {
        trakParts.push(slice(u8, tk.start, tk.start + tk.size));
        wroteEdts = true;
      } else if (tk.type === "mdia") {
        trakParts.push(mdiaNew);
      } else {
        trakParts.push(slice(u8, tk.start, tk.start + tk.size));
      }
    }
    if (!wroteEdts && edts) trakParts.unshift(edts);
    return { trak: box("trak", trakParts), presentationDurationMovie: presentationDurationMovie + delayMovie };
  }

  function buildMoov(dv, u8, moov, samples) {
    var kids = children(dv, u8, moov);
    var mvhd = findBox(kids, "mvhd");
    if (!mvhd) throw new Error("moov sem mvhd");
    var mvv = fullBoxVersion(u8, mvhd);
    var movieTimescale = mvv === 1 ? u32(dv, mvhd.start + mvhd.hdr + 4 + 16) : u32(dv, mvhd.start + mvhd.hdr + 4 + 8);

    // O tamanho do moov novo desloca todas as amostras; como stco depende
    // desse tamanho e o tamanho depende de stco (número de entradas, não
    // dos valores), fazemos duas passagens: a primeira só para medir.
    function assemble(shift) {
      var traks = [];
      var maxDur = 0;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].type !== "trak") continue;
        var built = buildTrak(dv, u8, kids[i], samples, movieTimescale, shift);
        if (!built) continue;
        traks.push(built.trak);
        if (built.presentationDurationMovie > maxDur) maxDur = built.presentationDurationMovie;
      }
      if (traks.length === 0) throw new Error("nenhuma faixa com amostras");
      // mvhd: v0 creation(4) mod(4) timescale(4) duration(4) => 16; v1 => 24
      var mvhdNew = patchDuration(u8, mvhd, 16, 24, maxDur);
      var parts = [mvhdNew];
      for (var j = 0; j < kids.length; j++) {
        var k = kids[j];
        if (k.type === "mvhd" || k.type === "trak" || k.type === "mvex") continue;
        parts.push(slice(u8, k.start, k.start + k.size));
      }
      return box("moov", parts.concat(traks));
    }
    var probe = assemble(0);
    return assemble(probe.length);
  }

  // ---------- API ----------

  // Recebe um ArrayBuffer com o fMP4 e devolve um array de partes
  // (Uint8Array) que, concatenadas (ex.: new Blob(parts)), formam o MP4
  // clássico. Lança erro se o arquivo não parecer um fMP4 válido.
  function remuxFragmentedMp4(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    var top = readBoxes(dv, u8, 0, u8.length);

    var ftyp = findBox(top, "ftyp");
    var moov = findBox(top, "moov");
    if (!moov) throw new Error("arquivo sem moov");
    var hasMoof = top.some(function (b) { return b.type === "moof"; });
    if (!hasMoof) throw new Error("arquivo não é fragmentado");

    var moovKids = children(dv, u8, moov);
    var trexMap = parseTrex(dv, u8, findBox(moovKids, "mvex"));
    var samples = collectSamples(dv, u8, top, trexMap);

    // O moov novo entra logo após o ftyp (ou no começo, se não houver ftyp).
    var insertAt = ftyp ? ftyp.start + ftyp.size : 0;
    var newMoov = buildMoov(dv, u8, moov, samples);
    // shift real = tamanho do moov novo (deslocamento de tudo após insertAt).
    // buildMoov já usou esse tamanho (duas passagens), então basta conferir.
    var shift = newMoov.length;

    var parts = [];
    if (ftyp) parts.push(slice(u8, ftyp.start, ftyp.start + ftyp.size));
    parts.push(newMoov);

    // Resto do arquivo, com moov/moof/mfra/sidx transformados em "free".
    var neutralize = { moov: 1, moof: 1, mfra: 1, sidx: 1, styp: 1 };
    for (var i = 0; i < top.length; i++) {
      var b = top[i];
      if (b.type === "ftyp") continue;
      if (b.start < insertAt) continue;
      if (neutralize[b.type]) {
        var head = new Uint8Array(u8.subarray(b.start, b.start + b.hdr));
        head[b.hdr - 4] = 0x66; // 'f'
        head[b.hdr - 3] = 0x72; // 'r'
        head[b.hdr - 2] = 0x65; // 'e'
        head[b.hdr - 1] = 0x65; // 'e'
        parts.push(head);
        parts.push(slice(u8, b.start + b.hdr, b.start + b.size));
      } else if (b.type === "mdat" && u32(dv, b.start) === 0) {
        // mdat "até o fim do arquivo": grava tamanho explícito para não
        // depender do EOF.
        var mh = new Uint8Array(8);
        new DataView(mh.buffer).setUint32(0, b.size);
        mh[4] = 0x6d; mh[5] = 0x64; mh[6] = 0x61; mh[7] = 0x74;
        parts.push(mh);
        parts.push(slice(u8, b.start + b.hdr, b.start + b.size));
      } else {
        parts.push(slice(u8, b.start, b.start + b.size));
      }
    }
    return { parts: parts, shift: shift };
  }

  return remuxFragmentedMp4;
});
