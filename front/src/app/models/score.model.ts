export interface ScoreMetadata {
  id: string;
  title: string;
  composer: string;
  arranger: string;
  copyright: string;
  tempo: number;
  keySignature: string;
  timeSignature: string;
  measures: number;
}

export interface ScoreNote {
  pitch: {
    name: string;
    octave: number;
    midi: number;
  };
  duration: number;
  measure: number;
  beat: number;
  trombonePosition?: string;
}

export interface Score {
  metadata: ScoreMetadata;
  notes: ScoreNote[];
  xml: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface ScoreHistory {
  id: string;
  scoreId: string;
  transpose: number;
  zoom: number;
  positionsVisible: boolean;
  viewedAt: Date;
}
