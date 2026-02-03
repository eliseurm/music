import { Injectable } from '@angular/core';

interface NoteInfo {
  step: string;
  alter: number;
  octave: number;
  position: number;
  accidental?: string;
  pitchClass?: number;
}

@Injectable({
  providedIn: 'root'
})
export class TrombonePositionService {
  private positionsAdded: boolean = false;
  private lastPositionText: string = 'NONE';
  private svgObserver: MutationObserver | null = null;

  constructor() {}

  // Configura um observador para o SVG para manter as posições após mudanças (como zoom)
  private setupSVGObserver(svg: SVGSVGElement): void {
    if (this.svgObserver) {
      this.svgObserver.disconnect();
    }

    this.svgObserver = new MutationObserver((mutations) => {
      // Verificar se o SVG foi reconstruído ou modificado significativamente
      let shouldReapply = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Se o SVG foi removido e recolocado, ou se os elementos internos mudaram
          const svgInDom = document.querySelector('.osmd-container svg');
          if (svgInDom && (mutation.removedNodes.length > 0 || mutation.addedNodes.length > 0)) {
            const positions = svgInDom.querySelectorAll('.trombone-position');
            if (this.positionsAdded && positions.length === 0) {
              shouldReapply = true;
              break;
            }
          }
        }
      }

      if (shouldReapply) {
        console.log('[Trombone Service] Detectada mudança no SVG, reaplicando posições...');
        // Usar um pequeno timeout para garantir que o OSMD terminou de renderizar
        setTimeout(() => {
          if (this.positionsAdded) {
            this.addPositionsToExample();
          }
        }, 50);
      }
    });

    this.svgObserver.observe(svg.parentElement || svg, {
      childList: true,
      subtree: true
    });
  }

  // Verifica se uma pauta é de trombone analisando o MusicXML
  private isTromboneStaff(xmlDoc: Document, partIndex: number): boolean {
    try {
      // Encontrar todas as partes
      const parts = xmlDoc.getElementsByTagName('score-part');

      if (partIndex < parts.length) {
        const part = parts[partIndex];

        // Verificar nome da parte (part-name)
        const partNameElem = part.getElementsByTagName('part-name')[0];
        if (partNameElem) {
          const partName = (partNameElem.textContent || '').toLowerCase();
          if (partName.includes('trombone') || partName.includes('trombone')) {
            return true;
          }
        }

        // Verificar nome do instrument
        const instrumentElems = part.getElementsByTagName('instrument-name');
        for (let i = 0; i < instrumentElems.length; i++) {
          const instrumentName = (instrumentElems[i].textContent || '').toLowerCase();
          if (instrumentName.includes('trombone') || instrumentName.includes('trombone')) {
            return true;
          }
        }

        // Verificar ID do instrument (instrument-id)
        const instrumentIdElems = part.getElementsByTagName('instrument-id');
        for (let i = 0; i < instrumentIdElems.length; i++) {
          const instrumentId = (instrumentIdElems[i].textContent || '').toLowerCase();
          if (instrumentId.includes('trombone') || instrumentId.includes('tbone')) {
            return true;
          }
        }

        // Verificar nas attributes do primeiro compasso
        const partsList = xmlDoc.getElementsByTagName('part');
        if (partIndex < partsList.length) {
          const partElement = partsList[partIndex];
          const firstMeasure = partElement.getElementsByTagName('measure')[0];
          if (firstMeasure) {
            const attributes = firstMeasure.getElementsByTagName('attributes')[0];
            if (attributes) {
              const instrumentNameAttr = attributes.getElementsByTagName('instrument-name')[0];
              if (instrumentNameAttr) {
                const name = (instrumentNameAttr.textContent || '').toLowerCase();
                if (name.includes('trombone')) {
                  return true;
                }
              }
            }
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Erro ao verificar instrumento:', error);
      return false;
    }
  }

  // === FUNÇÕES EXATAS DO PLUGIN DO MUSESCORE ===

  // Função slidePositionForPitchClass (idêntica ao plugin)
  private slidePositionForPitchClass(pc: number): number | null {
    switch (pc) {
      case 11: return 7;  // B / Si
      case 0:  return 6;  // C / Do
      case 1:  return 5;  // Db / C#
      case 2:  return 4;  // D / Re
      case 3:  return 3;  // Eb / D#
      case 4:  return 2;  // E / Mi
      case 5:  return 1;  // F / Fa
      case 6:  return 5;  // Gb / F#
      case 7:  return 4;  // G / Sol
      case 8:  return 3;  // Ab / G#
      case 9:  return 2;  // A / La
      case 10: return 1;  // Bb / A#
      default: return null;
    }
  }

  // Função getAlternatePosition (idêntica ao plugin)
  private getAlternatePosition(pc: number, oct: number): number | null {
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
          case 0: return 6;  // C3
          case 4: return 2;  // E3
          case 7: return 4;  // G3
          case 9: return 2;  // A3
          case 11: return 4; // B3
        }
        break;
      case 4:
        switch (pc) {
          case 0: return 3;  // C4
          case 1: return 2;  // Db4 / C#4
          case 2: return 1;  // D4
          case 4: return 2;  // E4
          case 5: return 1;  // F4
          case 7: return 2;  // G4
          case 11: return 2; // B4
        }
        break;
      case 5:
        switch (pc) {
          case 0: return 1;  // C5
          case 2: return 1;  // D5
        }
        break;
    }
    // Se não encontrou nenhuma exceção, retorna null
    return null;
  }

  // Função slidePositionForNote (lógica completa do plugin)
  private slidePositionForNote(note: NoteInfo): { position: number, accidental?: string } | null {
    const pc = this.getPitchClass(note.step, note.alter);
    if (pc === null) return null;

    // 1. Tenta encontrar uma posição alternativa específica para esta nota (ex: C#4 -> 2)
    const alternatePos = this.getAlternatePosition(pc, note.octave);
    if (alternatePos !== null) {
      return { position: alternatePos, accidental: note.alter !== 0 ? this.getAccidentalSymbol(note.alter) : undefined };
    }

    // 2. Se não houver alternativa, usa a posição padrão baseada no som da nota
    const standardPos = this.slidePositionForPitchClass(pc);
    if (standardPos !== null) {
      return {
        position: standardPos,
        accidental: note.alter !== 0 ? this.getAccidentalSymbol(note.alter) : undefined
      };
    }

    return null;
  }

  // Helper para calcular pitch class (C=0)
  private getPitchClass(step: string, alter: number): number | null {
    const baseNotes = new Map<string, number>([['C', 0], ['D', 2], ['E', 4], ['F', 5], ['G', 7], ['A', 9], ['B', 11]]);

    if (!baseNotes.has(step)) return null;

    const pcValue = baseNotes.get(step)!; // ! porque já validamos com has()
    let pc = pcValue + alter;

    while (pc < 0) pc += 12;
    while (pc >= 12) pc -= 12;

    return pc;
  }

  // Helper para símbolo de acidente
  private getAccidentalSymbol(alter: number): string {
    switch (alter) {
      case 1: return "#";
      case -1: return "b";
      case 2: return "##";
      case -2: return "bb";
      default: return "";
    }
  }

  // Função para extrair informações da nota do XML
  private extractNoteInfo(noteElement: Element): NoteInfo | null {
    try {
      // Ignorar silêncios
      const rest = noteElement.getElementsByTagName('rest');
      if (rest.length > 0) return null;

      // Extrair pitch
      const pitch = noteElement.getElementsByTagName('pitch')[0];
      if (!pitch) return null;

      const stepElem = pitch.getElementsByTagName('step')[0];
      const alterElem = pitch.getElementsByTagName('alter')[0];
      const octaveElem = pitch.getElementsByTagName('octave')[0];

      if (!stepElem || !octaveElem) return null;

      const step = stepElem.textContent || '';
      const alter = alterElem ? parseInt(alterElem.textContent || '0', 10) : 0;
      const octave = parseInt(octaveElem.textContent || '0', 10);

      // Calcular pitch class
      const pc = this.getPitchClass(step, alter);

      return {
        step,
        alter,
        octave,
        position: 0, // Será calculado depois
        pitchClass: pc !== null ? pc : undefined
      };
    } catch (error) {
      console.error('Erro ao extrair informações da nota:', error);
      return null;
    }
  }

  // Analisa o MusicXML para encontrar e adicionar posições apenas em pautas de trombone
  addPositionsToXML(xmlContent: string): string {
    try {
      console.log('[Trombone Service] Analisando MusicXML para adicionar posições...');

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

      // Verificar erros de parsing
      const parserError = xmlDoc.getElementsByTagName('parsererror');
      if (parserError.length > 0) {
        console.error('Erro ao analisar XML:', parserError[0].textContent);
        return xmlContent;
      }

      // Encontrar todas as partes
      const parts = xmlDoc.getElementsByTagName('part');
      console.log(`[Trombone Service] Encontradas ${parts.length} partes no XML`);

      // Processar cada parte
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];

        // Verificar se é uma pauta de trombone
        if (!this.isTromboneStaff(xmlDoc, partIndex)) {
          console.log(`[Trombone Service] Parte ${partIndex + 1} não é trombone, ignorando...`);
          continue;
        }

        console.log(`[Trombone Service] Processando parte ${partIndex + 1} (Trombone)`);

        // Resetar última posição para cada parte (como no plugin: textold = "<<<none>>>")
        this.lastPositionText = 'NONE';
        const staffNumber = partIndex + 1;

        // Encontrar todos os compassos
        const measures = part.getElementsByTagName('measure');

        for (let m = 0; m < measures.length; m++) {
          const measure = measures[m];

          // Processar notas neste compasso
          const allElements = Array.from(measure.children);
          let notesInMeasure = allElements.filter(el => el.tagName === 'note');
          let noteCounter = 0;

          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            if (el.tagName !== 'note') continue;

            const note = el;
            const currentNoteIndex = noteCounter++;

            // Ignorar notas de outras vozes (plugin só processa Voice 1)
            const voice = note.getElementsByTagName('voice')[0];
            if (voice && voice.textContent !== '1') {
              console.log(`[Trombone Service] Nota ${currentNoteIndex} ignorada (voz ${voice.textContent})`);
              continue;
            }

            // Ignorar notas ligadas (tied) que não sejam o início da ligação
            const notations = note.getElementsByTagName('notations')[0];
            if (notations) {
              const tied = notations.getElementsByTagName('tied')[0];
              if (tied && tied.getAttribute('type') === 'stop') {
                console.log(`[Trombone Service] Nota ${currentNoteIndex} ignorada (fim de ligadura)`);
                continue;
              }
            }

            // Extrair informações da nota
            const noteInfo = this.extractNoteInfo(note);
            if (!noteInfo) {
              continue;
            }

            // REQUISITO: Ajustar number dos lyrics existentes para "2" em todas as notas do trombone
            // para garantir alinhamento consistente, mesmo que a nota não receba posição.
            const existingLyrics = Array.from(note.getElementsByTagName('lyric'));
            existingLyrics.forEach(lyric => {
              const idAttr = lyric.getAttribute('id');
              const idElem = lyric.getElementsByTagName('id')[0];
              const isPosTb = idAttr === 'pos-tb' || (idElem && idElem.textContent === 'pos-tb');

              if (!isPosTb) {
                lyric.setAttribute('number', '2');
              }
            });

            // Calcular posição (usando lógica idêntica ao plugin)
            const positionResult = this.slidePositionForNote(noteInfo);

            if (positionResult !== null) {
              // Criar texto da posição (FORMATO IDÊNTICO AO PLUGIN)
              let positionText = positionResult.position.toString();
              if (positionResult.accidental) {
                positionText += "\n" + positionResult.accidental;
              }

              const shouldAddPosition = positionText !== this.lastPositionText;

              if (shouldAddPosition) {
                console.log(`[Trombone Service] Adicionando posição "${positionText}" para nota ${noteInfo.step}${noteInfo.octave}`);

                // Adicionar posição ao compasso
                this.addPositionToMeasure(measure, positionText, staffNumber, note);

                // Atualizar última posição
                this.lastPositionText = positionText;
              } else {
                console.log(`[Trombone Service] Posição "${positionText}" repetida, ignorando.`);
              }
            }
          }
        }
      }

      // Converter de volta para string
      const serializer = new XMLSerializer();
      const newXml = serializer.serializeToString(xmlDoc);

      this.positionsAdded = true;
      console.log('[Trombone Service] Posições adicionadas com sucesso!');

      return newXml;

    } catch (error) {
      console.error('[Trombone Service] Erro ao processar MusicXML:', error);
      return xmlContent;
    }
  }

  private addPositionToMeasure(measure: Element, positionText: string, staffNumber: number, targetNote: Element): void {
    try {
      const doc = measure.ownerDocument;

      // O ajuste de number="2" para lyrics existentes agora é feito no loop principal
      // para abranger todas as notas, então removemos daqui para evitar redundância.

      // Criar o elemento lyric para a posição
      const lyric = doc.createElement('lyric');
      lyric.setAttribute('id', 'pos-tb');
      lyric.setAttribute('number', '1');
      lyric.setAttribute('relative-y', '-30');

      // Elemento identificador solicitado: <id>pos-tb</id>
      const idElem = doc.createElement('id');
      idElem.textContent = 'pos-tb';
      lyric.appendChild(idElem);

      const syllabic = doc.createElement('syllabic');
      syllabic.textContent = 'middle';
      lyric.appendChild(syllabic);

      const text = doc.createElement('text');
      // O texto da posição (pode conter acidente)
      text.textContent = positionText.replace('\n', '');
      lyric.appendChild(text);

      // Inserir o lyric na nota alvo
      targetNote.appendChild(lyric);

      console.log(`[Trombone Service] Posição "${positionText.replace('\n', '')}" adicionada como lyric id="pos-tb"`);

    } catch (error) {
      console.error('[Trombone Service] Erro ao adicionar posição ao compasso:', error);
    }
  }

  // Processar um arquivo XML já carregado no OSMD
  async addPositionsToXMLScore(osmd: any, xmlContent?: string): Promise<boolean> {
    try {
      if (!osmd) {
        console.error('[Trombone Service] OSMD não inicializado');
        return false;
      }

      // Tentar usar o XML fornecido ou extrair do OSMD
      const xml = xmlContent || this.extractXMLFromOSMD(osmd);
      if (!xml) {
        console.error('[Trombone Service] Não foi possível obter XML para processamento');
        return false;
      }

      console.log('[Trombone Service] XML obtido, processando...');

      // Adicionar posições ao XML (usando lógica idêntica ao plugin)
      const newXml = this.addPositionsToXML(xml);

      // Recarregar a partitura com as posições
      if (newXml !== xml) {
        console.log('[Trombone Service] Recarregando partitura com posições...');
        await osmd.load(newXml);
        osmd.render();
        console.log('[Trombone Service] Partitura recarregada com posições!');
        return true;
      }

      console.log('[Trombone Service] Nenhuma alteração no XML');
      return false;

    } catch (error) {
      console.error('[Trombone Service] Erro ao adicionar posições ao score:', error);
      return false;
    }
  }

  private extractXMLFromOSMD(osmd: any): string | null {
    try {
      console.log('[Trombone Service] Tentando extrair XML do OSMD...');

      // Tentar diferentes formas de acessar o XML
      if (osmd.sheet && osmd.sheet.SourceScore && osmd.sheet.SourceScore.originalMusicXML) {
        console.log('[Trombone Service] XML encontrado em SourceScore.originalMusicXML');
        return osmd.sheet.SourceScore.originalMusicXML;
      }

      // Tentar acessar propriedades internas (como no ScoreLoader)
      if (osmd['_sheet'] && osmd['_sheet']['musicXML']) {
        console.log('[Trombone Service] XML encontrado em _sheet.musicXML');
        return osmd['_sheet']['musicXML'];
      }

      if (osmd.sheet && osmd.sheet['musicXML']) {
        console.log('[Trombone Service] XML encontrado em sheet.musicXML');
        return osmd.sheet['musicXML'];
      }

      if (osmd['EngravingRules'] && osmd['EngravingRules']['musicXML']) {
        console.log('[Trombone Service] XML encontrado em EngravingRules.musicXML');
        return osmd['EngravingRules']['musicXML'];
      }

      // Tentar acessar via propriedade sheetMusicXML
      if (osmd.sheetMusicXML) {
        console.log('[Trombone Service] XML encontrado em sheetMusicXML');
        return osmd.sheetMusicXML;
      }

      console.warn('[Trombone Service] Não foi possível encontrar XML no objeto OSMD. Estrutura:', osmd);
      return null;
    } catch (error) {
      console.error('[Trombone Service] Erro ao extrair XML:', error);
      return null;
    }
  }

  // Método principal para adicionar posições
  addPositionsToScore(osmd?: any, xmlContent?: string): Promise<boolean> {
    return new Promise(async (resolve) => {
      try {
        console.log('[Trombone Service] Iniciando adição de posições...');

        // Tentar adicionar posições via XML (método preferencial para manter com zoom)
        const success = await this.addPositionsToXMLScore(osmd, xmlContent);

        // O usuário quer que usemos a classe que lê o XML, então removemos o fallback visual que causava problemas
        if (!success) {
          console.warn('[Trombone Service] Falha ao adicionar posições via XML');
        }

        this.positionsAdded = true;
        resolve(success);
      } catch (error) {
        console.error('[Trombone Service] Erro em addPositionsToScore:', error);
        this.positionsAdded = true;
        resolve(false);
      }
    });
  }

  // Método para adicionar posições de exemplo (fallback visual)
  addPositionsToExample(): void {
    try {
      console.log('[Trombone Service] Adicionando posições de exemplo...');

      // Limpar posições anteriores se houver (para evitar duplicidade no modo exemplo)
      this.removePositions();

      // Resetar últimas posições - O plugin usa "<<<none>>>"
      this.lastPositionText = 'NONE';

      // Encontrar o SVG
      const svg = document.querySelector('.osmd-container svg') as SVGSVGElement;
      if (!svg) {
        console.warn('[Trombone Service] SVG não encontrado para exemplo');
        return;
      }

      // Encontrar todos os grupos de notas
      const noteGroups = Array.from(svg.querySelectorAll('g.vf-note, g.note, g.osmd-note'));
      console.log(`[Trombone Service] Encontrados ${noteGroups.length} grupos de notas`);

      if (noteGroups.length === 0) {
        console.warn('[Trombone Service] Nenhum grupo de notas encontrado no SVG');
        return;
      }

      // Adicionar observador de redimensionamento se não houver um
      this.setupSVGObserver(svg);

      // Notas de exemplo com posições calculadas
      const exampleNotes = [
        { step: 'C', alter: 0, octave: 4, pos: 3, acc: '' },      // C4 = posição 3
        { step: 'D', alter: 0, octave: 4, pos: 4, acc: '' },      // D4 = posição 4
        { step: 'E', alter: 0, octave: 4, pos: 2, acc: '' },      // E4 = posição 2
        { step: 'F', alter: 0, octave: 4, pos: 1, acc: '' },      // F4 = posição 1
      ];

      noteGroups.forEach((group: Element, index: number) => {
            // Ignorar se não for Voice 1 (tentar detectar via classe VexFlow se disponível)
            // No OSMD as notas de diferentes vozes costumam estar em grupos diferentes.

            // Encontrar a cabeça da nota
            const noteHead = group.querySelector('.vf-notehead path, circle, ellipse, rect, path');
            if (!noteHead) {
              return;
            }

            // Usar getBoundingClientRect para obter coordenadas reais no SVG
            const svgRect = svg.getBoundingClientRect();
            const noteRect = noteHead.getBoundingClientRect();

            // Centro horizontal da nota
            const cx = noteRect.left - svgRect.left + (noteRect.width / 2);
            // Base da nota para colocar abaixo
            const cy = noteRect.bottom - svgRect.top;

            if (cy && cx) {
              // Escolher nota de exemplo (cíclica)
              const noteInfo = exampleNotes[index % exampleNotes.length];
              const positionText = noteInfo.pos.toString() + (noteInfo.acc ? "\n" + noteInfo.acc : "");

              // LÓGICA: Só adiciona se for diferente (conforme o plugin)
              const shouldAdd = positionText !== this.lastPositionText;

              if (shouldAdd) {
                // Criar elemento de texto SVG
                const text = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');

                const lines = positionText.split("\n");
                text.textContent = lines[0];

                // Posicionar centralizado horizontalmente e fixo verticalmente abaixo
                text.setAttribute('x', cx.toString());
                text.setAttribute('y', (cy + 25).toString());
                text.setAttribute('class', 'trombone-position');
                text.setAttribute('fill', '#000000');
                text.setAttribute('font-size', '16');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('font-family', 'Arial, sans-serif');
                text.setAttribute('text-anchor', 'middle');

                // Adicionar ao SVG
                svg.appendChild(text);

                // Se tiver acidente, adicionar abaixo
                if (lines.length > 1 && lines[1]) {
                  const accText = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
                  accText.textContent = lines[1];
                  accText.setAttribute('x', cx.toString());
                  accText.setAttribute('y', (cy + 40).toString());
                  accText.setAttribute('class', 'trombone-position-accidental');
                  accText.setAttribute('fill', '#000000');
                  accText.setAttribute('font-size', '12');
                  accText.setAttribute('font-weight', 'bold');
                  accText.setAttribute('font-family', 'Arial, sans-serif');
                  accText.setAttribute('text-anchor', 'middle');
                  svg.appendChild(accText);
                }

                // Atualizar última posição
                this.lastPositionText = positionText;
              }
            }
      });

      console.log('[Trombone Service] Posições de exemplo adicionadas!');

    } catch (error) {
      console.error('[Trombone Service] Erro ao adicionar posições de exemplo:', error);
    }
  }

  removePositions(): void {
    try {
      console.log('[Trombone Service] Removendo posições...');

      if (this.svgObserver) {
        this.svgObserver.disconnect();
        this.svgObserver = null;
      }

      // Remover textos SVG
      const positions = document.querySelectorAll('.trombone-position, .trombone-position-accidental');
      console.log(`[Trombone Service] Removendo ${positions.length} elementos de posição`);

      positions.forEach(el => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      this.positionsAdded = false;
      this.lastPositionText = 'NONE';

      console.log('[Trombone Service] Posições removidas!');
    } catch (error) {
      console.error('[Trombone Service] Erro ao remover posições:', error);
    }
  }

  // Métodos auxiliares para transposição
  calculateKey(currentKey: string, semitones: number): string {
    const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const currentIndex = keys.indexOf(currentKey);
    if (currentIndex === -1) return currentKey;

    const newIndex = (currentIndex + semitones + 12) % 12;
    return keys[newIndex];
  }

  getSemitonesFromKey(fromKey: string, toKey: string): number {
    const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const fromIndex = keys.indexOf(fromKey);
    const toIndex = keys.indexOf(toKey);

    if (fromIndex === -1 || toIndex === -1) return 0;

    return (toIndex - fromIndex + 12) % 12;
  }

  hasPositions(): boolean {
    return this.positionsAdded;
  }
}
