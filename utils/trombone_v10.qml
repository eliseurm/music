import QtQuick 2.9
import MuseScore 3.0

MuseScore {
    categoryCode: "Metais"
    title: "Positions do Trombone V10"
    menuPath: "Plugins.Trombone.Aplicar posições"
    description: qsTr("Procura Pautas de Trombone (apenas Voice 1) e escreve posição da vara (1–7) acima de cada nota.")
    version: "8.4"
    pluginType: "dock" // -- este comentario deve ficar aqui, se tirar o espaco que esta logo apos as aspas, abre uma dialog
    requiresScore: true

    // === Configs simples ===
    property bool   debug: true                 // logs no -d
    property bool   overwriteExisting: true     // (só afetava StaffText; mantido)
    property bool   useOrdinalSuffix: false     // "3ª" em vez de "3"
    property string prefixText: ""              // ex.: "P" -> "P3"
    property string pluginMarker: ""            // vazio => limpeza de StaffText desativada

    // === Utils ===
    QtObject {
        id: utils

        // Base por pitch-class (C=0)
        function slidePositionForPitchClass(pc) {
            switch (pc) {
            case 11: return 7;  // B / Si
            case 0:  return 6;  // C / Do
            case 1:  return 5;  // C#/Db
            case 2:  return 4;  // D / Re
            case 3:  return 3;  // Eb/D#
            case 4:  return 2;  // E / Mi
            case 5:  return 1;  // F / Fa
            case 6:  return 5;  // F#/Gb
            case 7:  return 4;  // G / Sol
            case 8:  return 3;  // Ab/G#
            case 9:  return 2;  // A / La
            case 10: return 1;  // Bb/A#
            default: return null;
            }
        }

        // Detecta staff de Trombone olhando a Voice 1
        function isTromboneStaff(s) {
            var c = curScore.newCursor();
            c.track = s * 4; // Voice 1
            c.rewind(0);
            var safety = 0, MAX = 50000;
            while (!c.eos && safety++ < MAX) {
                if (c.element && c.element.staff && c.element.staff.part) {
                    var p = c.element.staff.part;
                    var n = (p.longName || p.shortName || p.partName ||
                             (p.instrument && p.instrument.name) || p.instrumentId || "");
                    n = (""+n).toLowerCase();
                    return n.indexOf("trombone") !== -1;
                }
                var segBefore = c.segment;
                c.next();
                if (c.segment === segBefore) break;
            }
            return false;
        }

        // Remoção de StaffText (mantive comportamento seguro: só se pluginMarker definido)
        function removeExistingTextsAtCursorSegment(cursor, pluginMarker) {
            if (!pluginMarker) return;
            var seg = cursor.segment;
            if (!seg || !seg.annotations) return;
            for (var i = seg.annotations.length - 1; i >= 0; --i) {
                var a = seg.annotations[i];
                if (a && a.type === Element.STAFF_TEXT && a.text &&
                    a.text.indexOf(pluginMarker) === 0) {
                    seg.remove(a);
                }
            }
        }

        // Acidente (#/b) pela soletração real (TPC)
        function accidentalFromTPCStrict(note) {
            if (note && typeof note.tpc === "number") {
                var tpc = note.tpc;
                var NAT_BASE = [14, 15, 16, 17, 18, 19, 13]; // C G D A E B F
                var cls = ((tpc % 7) + 7) % 7;      // 0..6
                var base = NAT_BASE[cls];
                var k = Math.round((tpc - base) / 7); // -2..+2
                if (k === 0) return "";
                if (k === 1) return "#";
                if (k === -1) return "b";
                if (k === 2) return "##";
                if (k === -2) return "bb";
            }
            return "";
        }

        // Oitava MIDI (C4=60 -> 4)
        function midiOct(pitch) { return Math.floor(pitch/12) - 1; }

        function isNatural(note) { return accidentalFromTPCStrict(note) === ""; }

        // --- helpers para mapear TPC classe -> pitch-class do natural
        function tpcClassToNaturalPc(cls) {
            // classes 0..6 -> naturais C G D A E B F  => pcs 0,7,2,9,4,11,5
            var NAT_PC = [0,7,2,9,4,11,5];
            return (cls >=0 && cls <=6) ? NAT_PC[cls] : null;
        }

        function getAlternatePosition(pc, oct) {
            switch (oct) {
                case 2:
                    switch (pc) {
                        case 4: return 7;  // E2
                        case 5: return 6;  // F2
                        case 11: return 7; // B2
                    }
                    break;
                case 3:
                    switch (pc) {
                        case 4: return 2;  // E3
                        case 7: return 4;  // G3
                        case 9: return 2;  // A3
                        case 11: return 4; // B3
                    }
                    break;
                case 4:
                    switch (pc) {
                        case 0: return 3;  // C4
                        case 1: return 2;  // C#4 / Db4   <-- NOSSO CASO ESPECIAL AQUI!
                        case 2: return 1;  // D4
                        case 4: return 2;  // E4
                        case 5: return 1;  // F4
                    }
                    break;
            }
            // Se não encontrou nenhuma exceção, retorna null
            return null;
        }

        function slidePositionForNote(note, chord) {
            if (!note || typeof note.pitch !== "number") return null;

            var pc  = note.pitch % 12;
            var oct = midiOct(note.pitch);

            // 1. Tenta encontrar uma posição alternativa específica para esta nota (ex: C#4 -> 2)
            var alternatePos = getAlternatePosition(pc, oct);
            if (alternatePos !== null) {
                return alternatePos;
            }

            // 2. Se não houver alternativa, usa a posição padrão baseada no som da nota
            return slidePositionForPitchClass(pc);
        }

    }

    // === Processa um staff de Trombone somente na Voice 1 ===
    function processTromboneStaff(staffIndex) {
        var cursor = curScore.newCursor();
        cursor.track = staffIndex * 4; // Voice 1
        cursor.rewind(0);

        if (debug) console.log("[tbone] process staff", staffIndex, "track", cursor.track);

        var steps = 0, STEPS_MAX = 200000;
        var textold = "<<<none>>>";

        while (!cursor.eos) {
            var segBefore = cursor.segment;
            var el = cursor.element;

            if (el && el.type === Element.CHORD) {
                if (overwriteExisting)
                    utils.removeExistingTextsAtCursorSegment(cursor, pluginMarker);

                var chord = el;
                if (chord.notes && chord.notes.length > 0) {
                    var note = chord.notes[0];
                    if (note && typeof note.pitch === "number") {
                        console.log("// DEBUG: log para inspecionar tpc/pitch/accidental quando quiser");
                        if (debug) {
                            console.log("[tbone-debug] pitch=", note.pitch,
                                        " pc=", (note.pitch % 12),
                                        " note.tpc=", (typeof note.tpc !== "undefined" ? note.tpc : "undef"),
                                        " chord.tpc=", (typeof chord.tpc !== "undefined" ? chord.tpc : "undef"),
                                        " accidental? ", note.accidental ? true : false);
                        }

                        // coloque isto antes de calcular pos
                        if (note.pitch >= 60 && note.pitch <= 62) { // ajuste a faixa se quiser
                            console.log("[tbone-inspect] pitch=", note.pitch,
                                        " pc=", (note.pitch % 12),
                                        " note.tpc=", (typeof note.tpc !== "undefined" ? note.tpc : "undef"),
                                        " chord.tpc=", (typeof chord.tpc !== "undefined" ? chord.tpc : "undef"),
                                        " note.accidental?", (note.accidental ? true : false),
                                        " chord.accidental?", (chord && chord.accidental ? true : false));
                            // e, se quiser enumerar props (caso precise):
                            for (var k in note) {
                                console.log("[tbone-prop note] ", k, "=", note[k]);
                            }
                        }

                        // passe também o chord para que slidePositionForNote possa buscar chord.tpc como fallback
                        var pos = utils.slidePositionForNote(note, chord);

                        if (pos !== null) {
                            var txt = "" + pos;                          // 1ª linha: número
                            var acc = utils.accidentalFromTPCStrict(note); // 2ª: #/b/##/bb (ou nada)
                            if (acc) txt += "\n" + acc;

                            if (txt && txt !== textold) {
                                var fb = newElement(Element.FIGURED_BASS);
                                fb.text = txt;
                                cursor.add(fb);
                                textold = txt;
                            }
                        }
                    }
                }
            }

            cursor.next();

            if (cursor.segment === segBefore) {
                if (debug) console.log("[tbone] cursor não avançou; abort staff", staffIndex);
                break;
            }
            if (++steps > STEPS_MAX) {
                if (debug) console.log("[tbone] limite de passos; abort staff", staffIndex);
                break;
            }
        }
    }

    function runJob() {
        if (!curScore) return;
        curScore.startCmd();

        var n = curScore.nstaves;
        if (debug) console.log("[tbone] nstaves=", n);

        for (var s = 0; s < n; ++s) {
            if (!utils.isTromboneStaff(s)) continue;   // só Trombone
            processTromboneStaff(s);                   // apenas Voice 1
        }

        curScore.endCmd();
        if (debug) console.log("[tbone] fim");
    }

    onRun: {
        try { runJob(); } catch (e) { console.log("[tbone] erro:", e); }
    }
}
