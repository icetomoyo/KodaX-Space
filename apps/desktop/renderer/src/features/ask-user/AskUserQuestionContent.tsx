import type { JSX, KeyboardEventHandler } from 'react';
import { ASK_USER_CUSTOM_INPUT_SIGNAL } from '@kodax-space/space-ipc-schema';

import { useI18n } from '../../i18n/I18nProvider.js';
import { truncate, type QuestionPayload } from './askUserQuestionRules.js';

const MAX_KEYBOARD_OPTIONS = 9;

export interface SelectableOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface MultiQuestionProgress {
  readonly index: number;
  readonly total: number;
  readonly onBack: () => void;
}

export interface AskUserQuestionContentProps {
  readonly question: QuestionPayload;
  readonly selectHint: string | null;
  readonly selectableOptions: readonly SelectableOption[];
  readonly keyboardOptions: readonly SelectableOption[];
  readonly selectedValues: ReadonlySet<string>;
  readonly inputValue: string;
  readonly customInputValue: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly errorId: string;
  readonly submitDisabled: boolean;
  readonly isHead: boolean;
  readonly multiProgress?: MultiQuestionProgress;
  readonly onInputChange: (value: string) => void;
  readonly onCustomInputChange: (value: string) => void;
  readonly onTextInputKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  readonly onToggleOption: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

export function AskUserQuestionContent(props: AskUserQuestionContentProps): JSX.Element {
  const { t } = useI18n();
  const customSelected = props.selectedValues.has(ASK_USER_CUSTOM_INPUT_SIGNAL);
  const multiSelect = props.question.multiSelect === true;
  const questionLabelId = `${props.errorId}-question`;
  const inputId = `${props.errorId}-input`;
  const customInputLabelId = `${props.errorId}-custom-input-label`;
  return (
    <div className="space-y-2">
      {props.multiProgress && (
        <div className="font-mono text-[10px] text-fg-muted">
          {props.multiProgress.index + 1}/{props.multiProgress.total}
        </div>
      )}
      {props.question.header && (
        <div className="font-mono text-[10px] uppercase text-fg-muted">
          {truncate(props.question.header, 96)}
        </div>
      )}
      {props.question.kind === 'input' ? (
        <>
          <label
            id={questionLabelId}
            htmlFor={inputId}
            className="block whitespace-pre-wrap text-sm leading-relaxed text-fg-primary"
          >
            {truncate(props.question.question, 1500)}
          </label>
          <textarea
            id={inputId}
            value={props.inputValue}
            data-ask-user-primary-focus
            autoFocus={props.isHead}
            disabled={props.busy}
            onChange={(event) => props.onInputChange(event.target.value)}
            onKeyDown={props.onTextInputKeyDown}
            aria-labelledby={questionLabelId}
            aria-describedby={props.error ? props.errorId : undefined}
            className="min-h-24 w-full resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
          />
        </>
      ) : (
        <>
          <fieldset
            className="space-y-2"
            aria-labelledby={questionLabelId}
            aria-describedby={props.error ? props.errorId : undefined}
          >
            <legend
              id={questionLabelId}
              className="mb-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-primary"
            >
              {truncate(props.question.question, 1500)}
            </legend>
            {props.selectHint && <div className="text-xs text-fg-muted">{props.selectHint}</div>}
            {props.selectableOptions.map((option, optionIndex) => {
              const selected = props.selectedValues.has(option.value);
              const isCustom = option.value === ASK_USER_CUSTOM_INPUT_SIGNAL;
              const keyIndex = props.keyboardOptions.indexOf(option);
              const optionId = `${props.errorId}-option-${optionIndex}`;
              const optionLabelId = `${optionId}-label`;
              const optionDescription = isCustom
                ? props.question.customInputPrompt
                : option.description;
              const optionDescriptionId = optionDescription ? `${optionId}-description` : undefined;
              return (
                <label
                  key={option.value}
                  className={`block w-full rounded border px-3 py-2 text-left transition focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40 ${
                    selected
                      ? 'border-ok bg-ok/12 text-fg-primary'
                      : 'border-border-default bg-surface text-fg-primary hover:bg-hover-bg'
                  } ${props.busy ? 'opacity-50' : ''}`}
                >
                  <input
                    type={multiSelect ? 'checkbox' : 'radio'}
                    name={`${props.errorId}-selection`}
                    checked={selected}
                    disabled={props.busy}
                    onChange={() => props.onToggleOption(option.value)}
                    aria-labelledby={optionLabelId}
                    aria-describedby={optionDescriptionId}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2">
                    {multiSelect ? (
                      <span
                        aria-hidden
                        className={`h-3.5 w-3.5 rounded-sm border ${
                          selected ? 'border-ok bg-ok' : 'border-fg-muted'
                        }`}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                          selected ? 'border-ok' : 'border-fg-muted'
                        }`}
                      >
                        {selected && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                      </span>
                    )}
                    <span id={optionLabelId} className="text-sm font-medium">
                      {truncate(option.label, 160)}
                    </span>
                    {keyIndex >= 0 && keyIndex < MAX_KEYBOARD_OPTIONS && (
                      <span
                        aria-hidden
                        className="ml-auto rounded border border-border-default px-1 font-mono text-[10px] text-fg-muted"
                      >
                        {keyIndex + 1}
                      </span>
                    )}
                  </div>
                  {optionDescription && (
                    <div id={optionDescriptionId} className="mt-1 text-xs text-fg-muted">
                      {truncate(optionDescription, 300)}
                    </div>
                  )}
                </label>
              );
            })}
          </fieldset>
          {customSelected && (
            <>
              <span id={customInputLabelId} className="sr-only">
                {props.question.customInputPrompt ?? t('askUser.typeYourAnswer')}
              </span>
              <textarea
                value={props.customInputValue}
                disabled={props.busy}
                onChange={(event) => props.onCustomInputChange(event.target.value)}
                onKeyDown={props.onTextInputKeyDown}
                placeholder={props.question.customInputPrompt ?? t('askUser.typeYourAnswer')}
                aria-labelledby={`${questionLabelId} ${customInputLabelId}`}
                aria-describedby={props.error ? props.errorId : undefined}
                className="min-h-20 w-full resize-y rounded border border-border-default bg-surface px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
              />
            </>
          )}
        </>
      )}
      {props.error && (
        <div id={props.errorId} role="alert" className="font-mono text-xs text-danger">
          {props.error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {props.multiProgress && props.multiProgress.index > 0 && (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.multiProgress.onBack}
            className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
          >
            {t('askUser.back')}
          </button>
        )}
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onCancel}
          className="rounded bg-surface-3 px-3 py-1.5 text-xs text-fg-primary hover:bg-hover-bg disabled:opacity-50"
        >
          {t('askUser.cancelEsc')}
        </button>
        <button
          type="button"
          disabled={props.submitDisabled}
          onClick={props.onSubmit}
          className="rounded border border-ok/50 bg-ok/15 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('askUser.submit')}
        </button>
      </div>
    </div>
  );
}
