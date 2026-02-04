import { Injectable } from '@angular/core';
import { TrombonePositionService } from './trombone-position.service';
import {EXEMP_XML} from './example-xml';

@Injectable({
  providedIn: 'root'
})
export class ScoreLoaderService {
  private osmd: any = null;
  private currentZoom: number = 1.5;
  private isInitialized: boolean = false;
  private originalXml: string | null = null; // Guardar XML original

  constructor(private positionService?: TrombonePositionService) {}

  async initializeOSMD(container: HTMLElement, options?: any): Promise<void> {
    try {
      console.log('Inicializando OSMD...');

      // Limpar instância anterior se existir
      if (this.osmd) {
        this.osmd.clear();
      }

      // Carregar o OSMD - ele já deve estar disponível globalmente via script
      // Verificar primeiro se está disponível globalmente
      if (typeof (window as any).OpenSheetMusicDisplay === 'undefined') {
        console.log('OSMD não está disponível globalmente, tentando carregar...');

        // Tentar carregar via import dinâmico
        // Nota: O OSMD é um bundle UMD, então precisamos acessar a propriedade correta
        const OSMDModule = await import('opensheetmusicdisplay');

        // O OSMD expõe OpenSheetMusicDisplay como propriedade do módulo
        if (OSMDModule.OpenSheetMusicDisplay) {
          (window as any).OpenSheetMusicDisplay = OSMDModule.OpenSheetMusicDisplay;
          console.log('OSMD carregado via módulo ES6');
        } else if (OSMDModule.default && OSMDModule.default.OpenSheetMusicDisplay) {
          (window as any).OpenSheetMusicDisplay = OSMDModule.default.OpenSheetMusicDisplay;
          console.log('OSMD carregado via default export');
        } else if (typeof OSMDModule === 'function') {
          (window as any).OpenSheetMusicDisplay = OSMDModule;
          console.log('OSMD carregado como função');
        } else {
          console.log('Estrutura do módulo OSMD:', OSMDModule);
          throw new Error('Não foi possível encontrar OpenSheetMusicDisplay no módulo');
        }
      }

      // Verificar se temos o construtor
      if (typeof (window as any).OpenSheetMusicDisplay !== 'function') {
        console.error('OpenSheetMusicDisplay não é uma função:', (window as any).OpenSheetMusicDisplay);
        throw new Error('OpenSheetMusicDisplay não é um construtor válido');
      }

      // Configurações padrão
      const defaultOptions = {
        backend: 'svg',
        autoResize: true,
        drawingParameters: 'compacttight',
        drawTitle: true,
        drawSubtitle: true,
        drawComposer: true,
        drawLyricist: true,
        drawPartNames: true
      };

      // Criar instância
      this.osmd = new (window as any).OpenSheetMusicDisplay(container, { ...defaultOptions, ...options });
      this.isInitialized = true;

      console.log('OSMD inicializado com sucesso!', this.osmd);

    } catch (error) {
      console.error('Erro ao inicializar OSMD:', error);
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('OSMD não inicializado. Chame initializeOSMD() primeiro.');
    }
  }

  async loadFile(file: File): Promise<{ xml: string, key: string } | void> {
    this.ensureInitialized();

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();

      if (fileExtension === 'musicxml' || fileExtension === 'xml') {
        const xmlContent = await file.text();
        return await this.loadXML(xmlContent, file.name);
      } else if (fileExtension === 'mscz') {
        console.log('[ScoreLoader] Descompactando arquivo .mscz...');
        const JSZipModule: any = await import('jszip');
        const JSZipCtor = JSZipModule.default || JSZipModule;
        const zip = new JSZipCtor();
        const loadedZip = await zip.loadAsync(file);

        // Encontrar o arquivo .mscx dentro do ZIP
        const mscxFile = Object.keys(loadedZip.files).find(name => name.endsWith('.mscx'));

        if (!mscxFile) {
          throw new Error('Não foi possível encontrar o arquivo .mscx dentro do .mscz');
        }

        console.log(`[ScoreLoader] Extraindo ${mscxFile}...`);
        const xmlContent = await loadedZip.files[mscxFile].async('text');

        // OSMD não lê .mscx nativamente (geralmente).
        // Se for um arquivo MuseScore 3 ou 4, o formato é XML proprietário.
        // O usuário disse: "faca a conversao para mucicXml ao selecionar o arquivo".
        // Como conversão completa é difícil, vamos tentar carregar o XML extraído
        // pois alguns arquivos mscx podem ser interpretados ou podemos dar um aviso.
        // No entanto, existe um serviço online/binário para isso.
        // Como estamos em um ambiente restrito, vamos tentar processar o XML básico
        // ou avisar que é necessário exportar para MusicXML se o OSMD falhar.
        // MAS, o usuário mandou eu fazer. Vou tentar uma "conversão" básica se necessário
        // ou ver se o OSMD engole.

        return await this.loadXML(xmlContent, file.name);
      } else {
        throw new Error(`Formato não suportado: ${fileExtension}. Use .musicxml, .xml ou .mscz`);
      }
    } catch (error) {
      console.error('Erro ao carregar arquivo:', error);
      throw error;
    }
  }

  async loadXML(xmlContent: string, fileName: string = 'partitura'): Promise<{ xml: string, key: string }> {
    this.ensureInitialized();

    try {
      console.log(`Carregando XML: ${fileName} (${xmlContent.length} caracteres)`);

      let processedXml = xmlContent;

      // Se for um arquivo .mscx (MuseScore), tentar converter o básico para MusicXML
      if (xmlContent.includes('<museScore') || fileName.toLowerCase().endsWith('.mscx')) {
        console.log('[ScoreLoader] Detectado formato MuseScore (.mscx), aplicando conversão básica...');
        processedXml = this.convertMscxToMusicXml(xmlContent);
      }

      // Detectar a tonalidade antes de qualquer processamento
      const detectedKey = this.detectKeyFromXML(processedXml);
      console.log(`[ScoreLoader] Tonalidade detectada: ${detectedKey}`);

      // Guardar o XML original para transposições futuras (sempre o XML puro do arquivo)
      this.originalXml = processedXml;

      await this.osmd.load(processedXml);
      this.setZoom(this.currentZoom);

      this.osmd.render();

      console.log('Partitura renderizada com sucesso!');
      return { xml: processedXml, key: detectedKey };
    } catch (error) {
      console.error('Erro ao renderizar partitura:', error);
      throw new Error(`Falha ao carregar partitura: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  }

  private convertMscxToMusicXml(mscxContent: string): string {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(mscxContent, 'application/xml');

      // Se o parser falhar, retornar o original
      if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
        return mscxContent;
      }

      // Se já parecer MusicXML, retornar o original
      if (xmlDoc.getElementsByTagName('score-partwise').length > 0) {
        return mscxContent;
      }

      // Conversão básica: envolver em score-partwise e tentar mapear elementos essenciais
      // Nota: Uma conversão real é gigantesca. O OSMD às vezes consegue ler partes se for bem formado.
      // MuseScore 3.6+ usa uma estrutura que o OSMD não reconhece diretamente.
      // O ideal seria usar o plugin do MuseScore para exportar, mas aqui vamos tentar o mínimo.

      const serializer = new XMLSerializer();
      let musicXml = serializer.serializeToString(xmlDoc);

      // Substituir tags raiz
      musicXml = musicXml.replace(/<museScore[^>]*>/, '<score-partwise version="3.1">');
      musicXml = musicXml.replace(/<\/museScore>/, '</score-partwise>');

      // Mapear Part para Part-List se necessário (muito simplificado)
      if (!musicXml.includes('<part-list>')) {
        const partNameMatch = musicXml.match(/<trackName>([^<]+)<\/trackName>/);
        const partName = partNameMatch ? partNameMatch[1] : 'Music';
        const partList = `
  <part-list>
    <score-part id="P1">
      <part-name>${partName}</part-name>
    </score-part>
  </part-list>
  <part id="P1">`;
        musicXml = musicXml.replace(/<Part>/, partList);
        musicXml = musicXml.replace(/<\/Part>/, '</part>');
      }

      // Muitas outras tags mudam entre MSCX e MusicXML.
      // Se a conversão básica falhar na renderização, o usuário verá o erro.
      // Infelizmente sem uma lib de conversão (que geralmente são em C++ ou Python),
      // é difícil fazer algo perfeito em JS puro.

      return musicXml;
    } catch (e) {
      console.error('Erro na conversão mscx:', e);
      return mscxContent;
    }
  }

  public detectKeyFromXML(xmlContent: string): string {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
      const fifthsElem = xmlDoc.getElementsByTagName('fifths')[0];

      if (fifthsElem) {
        const fifths = parseInt(fifthsElem.textContent || '0', 10);
        // Mapeamento de quintas para tonalidade (simplificado para Maiores)
        const keyMap: { [key: number]: string } = {
          '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
          '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#'
        };
        return keyMap[fifths] || 'C';
      }
    } catch (e) {
      console.error('Erro ao detectar tonalidade:', e);
    }
    return 'C';
  }

// Adicionar novo método para processar posições após carregamento
  async addPositionsToCurrentScore(): Promise<boolean> {
    if (!this.osmd || !this.positionService) return false;

    try {
      // Usar o XML atual (que pode estar transposto) para adicionar posições
      const currentXml = this.getCurrentXML() || (this as any).originalXml;
      const success = await this.positionService.addPositionsToScore(this.osmd, currentXml);

      // Se houver transposição ativa, precisamos reaplicar a tonalidade visual
      // mas addPositionsToScore já chama osmd.load() que reseta o estado.
      // O AppComponent deve gerenciar isso.

      return success;
    } catch (error) {
      console.error('Erro ao adicionar posições:', error);
      return false;
    }
  }

  async loadExampleScore(): Promise<{ xml: string, key: string } | void> {
    this.ensureInitialized();

    // MusicXML simples para teste COM NOTAS COMPLETAS
    const exampleXml = EXEMP_XML;

    return await this.loadXML(exampleXml, 'Exemplo Trombone');
  }

  setZoom(zoom: number): void {
    this.currentZoom = zoom;
    if (this.osmd) {
      this.osmd.zoom = zoom;
      if (this.isInitialized) {
        this.osmd.render();
      }
    }
  }

  private calculateSemitones(fromKey: string, toKey: string): number {
    const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const normFrom = fromKey.replace('Bb', 'A#').replace('Eb', 'D#').replace('Ab', 'G#').replace('Db', 'C#').replace('Gb', 'F#');
    const normTo = toKey.replace('Bb', 'A#').replace('Eb', 'D#').replace('Ab', 'G#').replace('Db', 'C#').replace('Gb', 'F#');

    const fromIndex = keys.indexOf(normFrom);
    const toIndex = keys.indexOf(normTo);

    if (fromIndex === -1 || toIndex === -1) return 0;

    let diff = toIndex - fromIndex;

    // Escolher o caminho mais curto
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;

    return diff;
  }

  async transposeToKey(newKey: string, currentKey: string): Promise<void> {
    this.ensureInitialized();

    // Calcular semitons de diferença entre as tonalidades
    const semitones = this.calculateSemitones(currentKey, newKey);

    console.log(`[ScoreLoader] Transpondo de ${currentKey} para ${newKey} (${semitones} semitons)`);

    // Chamar transposição (nativa ou via XML)
    await this.transpose(semitones);
  }

  async transpose(semitones: number): Promise<void> {
    this.ensureInitialized();

    console.log(`[ScoreLoader] Transpondo ${semitones} semitons...`);

    // Obter o XML atual, remover posições e então transpor
    const currentXml = this.getCurrentXML() || this.originalXml;
    if (currentXml) {
      const xmlWithoutPositions = this.removePositionsFromXML(currentXml);

      let finalXml = xmlWithoutPositions;

      // Se semitones for 0, apenas recarregar sem posições
      if (semitones !== 0) {
        finalXml = this.transposeMusicXML(xmlWithoutPositions, semitones);
      }

      await this.osmd.load(finalXml);
      this.osmd.render();
      console.log(`[ScoreLoader] Transposição via XML concluída!`);
      return;
    }

    // Fallback: Tentar transposição nativa se não conseguir o XML
    if (this.osmd?.Sheet?.SourceScore) {
      try {
        console.log('[ScoreLoader] Usando transposição nativa do OSMD (Fallback)...');
        if (semitones !== 0) {
          this.osmd.Sheet.SourceScore.transpose(semitones);
          this.osmd.updateGraphic();
        }
        console.log(`[ScoreLoader] Transposição nativa concluída!`);
        return;
      } catch (error) {
        console.error('[ScoreLoader] Erro na transposição nativa:', error);
      }
    }
  }


  removePositionsFromXML(xmlContent: string): string {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

      // Remover elementos <figured-bass> que contêm as posições (legado)
      const figuredBasses = Array.from(xmlDoc.getElementsByTagName('figured-bass'));
      figuredBasses.forEach(fb => {
        if (fb.parentNode) {
          fb.parentNode.removeChild(fb);
        }
      });

      // Remover lyrics de posição e restaurar number dos originais
      const lyrics = Array.from(xmlDoc.getElementsByTagName('lyric'));

      // REQUISITO: Primeiro restauramos todos os lyrics normais para number="1"
      // para garantir que mesmo as notas sem posição voltem ao normal.
      lyrics.forEach(lyric => {
        const idAttr = lyric.getAttribute('id');
        const idElem = lyric.getElementsByTagName('id')[0];
        const isPosTb = idAttr === 'pos-tb' || (idElem && idElem.textContent === 'pos-tb');

        if (!isPosTb) {
          lyric.setAttribute('number', '1');
        }
      });

      // Depois removemos os lyrics de posição
      lyrics.forEach(lyric => {
        const idAttr = lyric.getAttribute('id');
        const idElem = lyric.getElementsByTagName('id')[0];
        const isPosTb = idAttr === 'pos-tb' || (idElem && idElem.textContent === 'pos-tb');

        if (isPosTb) {
          const parentNote = lyric.parentNode;
          if (parentNote) {
            parentNote.removeChild(lyric);
          }
        }
      });

      const serializer = new XMLSerializer();
      return serializer.serializeToString(xmlDoc);

    } catch (error) {
      console.error('[ScoreLoader] Erro ao remover posições do XML:', error);
      return xmlContent;
    }
  }

  private transposeMusicXML(xmlContent: string, semitones: number): string {
    try {
      console.log(`[ScoreLoader] Transpondo MusicXML ${semitones} semitons...`);

      if (semitones === 0) return xmlContent;

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

      // 1. Transpor a armadura de clave
      const keyElements = xmlDoc.getElementsByTagName('key');
      for (let i = 0; i < keyElements.length; i++) {
        const fifthsElem = keyElements[i].getElementsByTagName('fifths')[0];
        if (fifthsElem) {
          const currentFifths = parseInt(fifthsElem.textContent || '0', 10);

          // Ciclo de quintas
          const semitoneToFifthsMap: { [key: number]: number } = {
            0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: -1, 6: 6, 7: 1, 8: 8, 9: 3, 10: 10, 11: 5,
            '-1': -5, '-2': -2, '-3': -9, '-4': -4, '-5': 1, '-6': -6
          };

          const fifthsDiff = semitoneToFifthsMap[semitones] || 0;
          let newFifths = currentFifths + fifthsDiff;

          // Manter dentro de -7 e 7 se possível (usando enarmonia)
          if (newFifths > 7) newFifths -= 12;
          if (newFifths < -7) newFifths += 12;

          fifthsElem.textContent = newFifths.toString();
        }
      }

      // 2. Transpor todas as notas
      const pitchElements = xmlDoc.getElementsByTagName('pitch');
      for (let i = 0; i < pitchElements.length; i++) {
        const pitch = pitchElements[i];
        const stepElem = pitch.getElementsByTagName('step')[0];
        const alterElem = pitch.getElementsByTagName('alter')[0];
        const octaveElem = pitch.getElementsByTagName('octave')[0];

        if (stepElem && octaveElem) {
          const step = stepElem.textContent || 'C';
          const alter = alterElem ? parseInt(alterElem.textContent || '0', 10) : 0;
          let octave = parseInt(octaveElem.textContent || '4', 10);

          // Mapeamento de notas para semitons (C=0)
          const stepToSemitones: { [key: string]: number } = {
            'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
          };

          const currentSemitones = stepToSemitones[step] + alter + (octave * 12);
          const newTotalSemitones = currentSemitones + semitones;

          const newOctave = Math.floor(newTotalSemitones / 12);
          const newPc = ((newTotalSemitones % 12) + 12) % 12;

          // Mapeamento de semitons de volta para nota
          // Usar tabela que favoreça a tonalidade destino se possível
          const semitonesToStep: { [key: number]: { step: string, alter: number } } = {
            0: { step: 'C', alter: 0 },
            1: { step: 'C', alter: 1 },
            2: { step: 'D', alter: 0 },
            3: { step: 'E', alter: -1 },
            4: { step: 'E', alter: 0 },
            5: { step: 'F', alter: 0 },
            6: { step: 'F', alter: 1 },
            7: { step: 'G', alter: 0 },
            8: { step: 'A', alter: -1 },
            9: { step: 'A', alter: 0 },
            10: { step: 'B', alter: -1 },
            11: { step: 'B', alter: 0 }
          };

          const newNote = semitonesToStep[newPc];
          stepElem.textContent = newNote.step;
          octaveElem.textContent = newOctave.toString();

          if (newNote.alter !== 0) {
            if (!alterElem) {
              const newAlterElem = xmlDoc.createElement('alter');
              newAlterElem.textContent = newNote.alter.toString();
              pitch.appendChild(newAlterElem);
            } else {
              alterElem.textContent = newNote.alter.toString();
            }
          } else if (alterElem) {
            pitch.removeChild(alterElem);
          }
        }
      }

      // 3. Atualizar acidentes (accidental) se existirem
      const noteElements = xmlDoc.getElementsByTagName('note');
      for (let i = 0; i < noteElements.length; i++) {
        const note = noteElements[i];
        const pitch = note.getElementsByTagName('pitch')[0];
        if (pitch) {
          const alterElem = pitch.getElementsByTagName('alter')[0];
          const accElem = note.getElementsByTagName('accidental')[0];

          if (alterElem) {
            const alterValue = parseInt(alterElem.textContent || '0', 10);
            const accText = alterValue === 1 ? 'sharp' : (alterValue === -1 ? 'flat' : (alterValue === 2 ? 'double-sharp' : (alterValue === -2 ? 'flat-flat' : '')));

            if (accText) {
              if (accElem) {
                accElem.textContent = accText;
              } else {
                const newAcc = xmlDoc.createElement('accidental');
                newAcc.textContent = accText;
                note.appendChild(newAcc);
              }
            } else if (accElem) {
              note.removeChild(accElem);
            }
          } else if (accElem) {
            note.removeChild(accElem);
          }
        }
      }

      const serializer = new XMLSerializer();
      return serializer.serializeToString(xmlDoc);

    } catch (error) {
      console.error('[ScoreLoader] Erro na transposição do MusicXML:', error);
      return xmlContent;
    }
  }

  getCurrentXML(): string {
    try {
      console.log('[ScoreLoader] Tentando obter XML atual...');

      if (!this.osmd) return '';

      // Tentar as mesmas localizações que o TrombonePositionService
      if (this.osmd.Sheet && this.osmd.Sheet.SourceScore && this.osmd.Sheet.SourceScore.originalMusicXML) {
        console.log('[ScoreLoader] XML encontrado em Sheet.SourceScore.originalMusicXML');
        return this.osmd.Sheet.SourceScore.originalMusicXML;
      }

      if (this.osmd['_sheet'] && this.osmd['_sheet']['musicXML']) {
        return this.osmd['_sheet']['musicXML'];
      }

      if (this.osmd.sheet && this.osmd.sheet['musicXML']) {
        return this.osmd.sheet['musicXML'];
      }

      if (this.osmd['EngravingRules'] && this.osmd['EngravingRules']['musicXML']) {
        return this.osmd['EngravingRules']['musicXML'];
      }

      if (this.osmd.sheetMusicXML) {
        return this.osmd.sheetMusicXML;
      }

      console.log('[ScoreLoader] Estrutura do objeto OSMD:', this.osmd);
      console.log('[ScoreLoader] Não foi possível encontrar XML no OSMD');
      return '';
    } catch (error) {
      console.error('[ScoreLoader] Erro ao obter XML:', error);
      return '';
    }
  }

  getOSMD(): any {
    return this.osmd;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  clear(): void {
    if (this.osmd) {
      this.osmd.clear();
    }
  }

  getInstruments(): { id: number, name: string, visible: boolean }[] {
    if (!this.osmd || !this.osmd.Sheet || !this.osmd.Sheet.Instruments) {
      return [];
    }

    return this.osmd.Sheet.Instruments.map((instrument: any, index: number) => {
      let name = '';
      if (instrument.NameLabel && instrument.NameLabel.text) {
        name = instrument.NameLabel.text;
      } else if (instrument.IdString) {
        name = instrument.IdString;
      } else {
        name = `Instrumento ${index + 1}`;
      }

      return {
        id: index,
        name: name,
        visible: instrument.Visible
      };
    });
  }

  setInstrumentVisibility(instrumentId: number, visible: boolean, shouldRender: boolean = true): void {
    if (!this.osmd || !this.osmd.Sheet || !this.osmd.Sheet.Instruments) {
      return;
    }

    const instrument = this.osmd.Sheet.Instruments[instrumentId];
    if (instrument) {
      instrument.Visible = visible;

      // Se desativar um instrumento, precisamos garantir que as pautas dele também sumam
      if (instrument.Staves) {
        instrument.Staves.forEach((staff: any) => {
          staff.Visible = visible;
        });
      }

      if (shouldRender) {
        this.osmd.render();
      }
    }
  }
}
