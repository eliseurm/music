// components/toolbar/toolbar.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss']
})
export class ToolbarComponent {
  @Input() zoomLevel: number = 1.5;
  @Input() currentKey: string = 'C';
  @Input() showPositions: boolean = true;
  @Input() instruments: { id: number, name: string, visible: boolean }[] = [];
  @Input() fileName: string = '';

  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() toggleSidebar = new EventEmitter<void>(); // Adicionado
  @Output() togglePositions = new EventEmitter<void>();
  @Output() transposeToKey = new EventEmitter<string>();
  @Output() saveSettings = new EventEmitter<void>();
  @Output() instrumentVisibilityChange = new EventEmitter<{ id: number, visible: boolean }>();
  @Output() toggleFullscreen = new EventEmitter<void>();

  keys: string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'Bb', 'B'];

  onKeyChange(key: string): void {
    this.transposeToKey.emit(key);
  }

  onTogglePositions(): void {
    this.togglePositions.emit();
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onInstrumentToggle(id: number, event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.instrumentVisibilityChange.emit({ id, visible: checkbox.checked });
  }
}
