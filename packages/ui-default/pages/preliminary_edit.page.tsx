/* eslint-disable max-len, react-refresh/only-export-components */
import { nanoid } from 'nanoid';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import { i18n, request } from 'vj/utils';

type SectionType = 'single_choice' | 'program_reading' | 'program_completion';
type QuestionType = 'choice' | 'true_false';

interface Option { id: string, text: string }
interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  score: number;
  explanation: string;
  answer: string;
  options: Option[];
}
interface Section {
  id: string;
  type: SectionType;
  title: string;
  content: string;
  questions: Question[];
}
interface Definition { title: string, content: string, sections: Section[] }

const newOption = (): Option => ({ id: nanoid(10), text: '' });
const newQuestion = (type: QuestionType): Question => {
  if (type === 'true_false') {
    return { id: nanoid(10), type, prompt: '', score: 2, explanation: '', answer: 'true', options: [] };
  }
  const options = [newOption(), newOption(), newOption(), newOption()];
  return { id: nanoid(10), type, prompt: '', score: 2, explanation: '', answer: options[0].id, options };
};
const sectionNames: Record<SectionType, string> = {
  single_choice: 'Single-choice Questions',
  program_reading: 'Program Reading',
  program_completion: 'Program Completion',
};
const newSection = (type: SectionType): Section => ({
  id: nanoid(10),
  type,
  title: i18n(sectionNames[type]),
  content: '',
  questions: [newQuestion(type === 'program_reading' ? 'true_false' : 'choice')],
});

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

function PreliminaryEditor({ initial, existing, wasPublished }: {
  initial: Definition;
  existing: boolean;
  wasPublished: boolean;
}) {
  const [definition, setDefinition] = useState(initial);
  const [sectionType, setSectionType] = useState<SectionType>('single_choice');
  const [saving, setSaving] = useState(false);
  const [openExplanations, setOpenExplanations] = useState<Record<string, boolean>>(() => {
    const open: Record<string, boolean> = {};
    for (const section of initial.sections) {
      for (const question of section.questions) {
        if (question.explanation) open[question.id] = true;
      }
    }
    return open;
  });
  const showExplanation = (question: Question) => Boolean(question.explanation || openExplanations[question.id]);
  const setExplanationOpen = (questionId: string, open: boolean) => {
    setOpenExplanations((current) => ({ ...current, [questionId]: open }));
  };

  const updateSection = (sectionIndex: number, callback: (section: Section) => Section) => {
    setDefinition((current) => ({
      ...current,
      sections: current.sections.map((section, index) => (index === sectionIndex ? callback(section) : section)),
    }));
  };
  const updateQuestion = (sectionIndex: number, questionIndex: number, callback: (question: Question) => Question) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      questions: section.questions.map((question, index) => (index === questionIndex ? callback(question) : question)),
    }));
  };
  const save = async (published: boolean) => {
    setSaving(true);
    try {
      const response = await request.post('', { operation: 'save', definition, published });
      window.location.href = response.url;
    } catch (error) {
      Notification.error(error.message);
      setSaving(false);
    }
  };

  return <div className="preliminary-editor">
    <div className="section visible">
      <div className="section__header"><h1 className="section__title">{i18n(existing ? 'Edit Paper' : 'New Paper')}</h1></div>
      <div className="section__body">
        <label>{i18n('Title')}
          <input className="textbox" value={definition.title} onChange={(event) => setDefinition({ ...definition, title: event.currentTarget.value })} autoFocus />
        </label>
        <label>{i18n('Introduction')}
          <textarea className="textbox preliminary-editor__intro" rows={3} value={definition.content} onChange={(event) => setDefinition({ ...definition, content: event.currentTarget.value })} />
        </label>
      </div>
    </div>

    {definition.sections.map((section, sectionIndex) => <div className="section visible preliminary-editor__section" key={section.id}>
      <div className="section__header preliminary-editor__section-header">
        <h2 className="section__title">{i18n(sectionNames[section.type])}</h2>
        <div className="section__tools preliminary-editor__tools">
          <button type="button" className="compact button" title={i18n('Move up')} disabled={sectionIndex === 0} onClick={() => setDefinition({ ...definition, sections: move(definition.sections, sectionIndex, -1) })}><span className="icon icon-expand_less" /></button>
          <button type="button" className="compact button" title={i18n('Move down')} disabled={sectionIndex === definition.sections.length - 1} onClick={() => setDefinition({ ...definition, sections: move(definition.sections, sectionIndex, 1) })}><span className="icon icon-expand_more" /></button>
          <button type="button" className="compact button" title={i18n('Delete section')} onClick={() => setDefinition({ ...definition, sections: definition.sections.filter((_, index) => index !== sectionIndex) })}><span className="icon icon-delete" /></button>
        </div>
      </div>
      <div className="section__body">
        <label>{i18n('Section Title')}
          <input className="textbox" value={section.title} onChange={(event) => {
            const title = event.currentTarget.value;
            updateSection(sectionIndex, (value) => ({ ...value, title }));
          }} />
        </label>
        {section.type !== 'single_choice' && <label>{i18n('Passage / Program')}
          <textarea className="textbox monospace preliminary-editor__passage" rows={6} value={section.content} onChange={(event) => {
            const content = event.currentTarget.value;
            updateSection(sectionIndex, (value) => ({ ...value, content }));
          }} />
        </label>}
        <div className="preliminary-editor__questions">
          {section.questions.map((question, questionIndex) => <div className="preliminary-editor__question" key={question.id}>
            <div className="preliminary-editor__question-header">
              <span>{questionIndex + 1}. {i18n(question.type === 'true_false' ? 'True / False' : 'Single Choice')}</span>
              <div className="preliminary-editor__tools">
                <button type="button" className="compact button" title={i18n('Move up')} disabled={questionIndex === 0} onClick={() => updateSection(sectionIndex, (value) => ({ ...value, questions: move(value.questions, questionIndex, -1) }))}><span className="icon icon-expand_less" /></button>
                <button type="button" className="compact button" title={i18n('Move down')} disabled={questionIndex === section.questions.length - 1} onClick={() => updateSection(sectionIndex, (value) => ({ ...value, questions: move(value.questions, questionIndex, 1) }))}><span className="icon icon-expand_more" /></button>
                <button type="button" className="compact button" title={i18n('Delete question')} onClick={() => updateSection(sectionIndex, (value) => ({ ...value, questions: value.questions.filter((_, index) => index !== questionIndex) }))}><span className="icon icon-delete" /></button>
              </div>
            </div>
            <div className="preliminary-editor__prompt-row">
              <textarea className="textbox" rows={2} placeholder={i18n('Question')} value={question.prompt} onChange={(event) => {
                const prompt = event.currentTarget.value;
                updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, prompt }));
              }} />
              <input type="number" min="1" max="1000" step="1" className="textbox preliminary-editor__score" title={i18n('Points')} placeholder={i18n('Points')} value={question.score} onChange={(event) => {
                const score = Number(event.currentTarget.value);
                updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, score }));
              }} />
            </div>
            {question.type === 'true_false'
              ? <div className="preliminary-editor__truth"><label className="radiobox"><input type="radio" checked={question.answer === 'true'} onChange={() => updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, answer: 'true' }))} /> {i18n('True')}</label><label className="radiobox"><input type="radio" checked={question.answer === 'false'} onChange={() => updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, answer: 'false' }))} /> {i18n('False')}</label></div>
              : <div className="preliminary-editor__options">
                {question.options.map((option, optionIndex) => <div className="preliminary-editor__option" key={option.id}>
                  <input type="radio" name={`answer-${question.id}`} checked={question.answer === option.id} onChange={() => updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, answer: option.id }))} title={i18n('Correct answer')} />
                  <span>{String.fromCharCode(65 + optionIndex)}.</span>
                  <input className="textbox" value={option.text} onChange={(event) => {
                    const text = event.currentTarget.value;
                    updateQuestion(sectionIndex, questionIndex, (value) => ({
                      ...value,
                      options: value.options.map((item) => item.id === option.id ? { ...item, text } : item),
                    }));
                  }} />
                  <button type="button" className="compact button" title={i18n('Remove option')} onClick={() => updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, options: value.options.filter((item) => item.id !== option.id), answer: value.answer === option.id ? '' : value.answer }))}><span className="icon icon-delete" /></button>
                </div>)}
                <button type="button" className="compact button" onClick={() => updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, options: [...value.options, newOption()] }))}><span className="icon icon-add" /> {i18n('Add option')}</button>
              </div>}
            {showExplanation(question)
              ? <div className="preliminary-editor__explanation-wrap">
                <textarea className="textbox preliminary-editor__explanation" rows={2} placeholder={i18n('Explanation')} value={question.explanation} onChange={(event) => {
                  const explanation = event.currentTarget.value;
                  updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, explanation }));
                }} />
                <button type="button" className="compact button" title={i18n('Remove explanation')} onClick={() => {
                  updateQuestion(sectionIndex, questionIndex, (value) => ({ ...value, explanation: '' }));
                  setExplanationOpen(question.id, false);
                }}><span className="icon icon-delete" /></button>
              </div>
              : <div className="preliminary-editor__explanation-wrap">
                <button type="button" className="compact button" onClick={() => setExplanationOpen(question.id, true)}><span className="icon icon-add" /> {i18n('Add explanation')}</button>
              </div>}
          </div>)}
        </div>
        <div className="preliminary-editor__add-question">
          <button type="button" className="compact button" onClick={() => updateSection(sectionIndex, (value) => ({ ...value, questions: [...value.questions, newQuestion('choice')] }))}><span className="icon icon-add" /> {i18n('Choice Question')}</button>
          {section.type === 'program_reading' && <button type="button" className="compact button" onClick={() => updateSection(sectionIndex, (value) => ({ ...value, questions: [...value.questions, newQuestion('true_false')] }))}><span className="icon icon-add" /> {i18n('True / False')}</button>}
        </div>
      </div>
    </div>)}

    <div className="section visible"><div className="section__body preliminary-editor__footer">
      <div className="preliminary-editor__add-section">
        <select className="select compact" value={sectionType} onChange={(event) => setSectionType(event.currentTarget.value as SectionType)}>{Object.entries(sectionNames).map(([value, label]) => <option value={value} key={value}>{i18n(label)}</option>)}</select>
        <button type="button" className="compact button" onClick={() => setDefinition({ ...definition, sections: [...definition.sections, newSection(sectionType)] })}><span className="icon icon-add" /> {i18n('Add Section')}</button>
      </div>
      <div className="preliminary-editor__save">
        {wasPublished
          ? <><button type="button" className="compact button" disabled={saving} onClick={() => save(false)}>{i18n('Unpublish')}</button><button type="button" className="compact primary button" disabled={saving} onClick={() => save(true)}>{i18n('Save Changes')}</button></>
          : <><button type="button" className="compact button" disabled={saving} onClick={() => save(false)}>{i18n('Save Draft')}</button><button type="button" className="compact primary button" disabled={saving} onClick={() => save(true)}>{i18n('Publish')}</button></>}
      </div>
    </div></div>
  </div>;
}

const page = new NamedPage(['preliminary_create', 'preliminary_edit'], () => {
  const container = document.getElementById('preliminary-editor');
  const config = UiContext.preliminaryEditor as {
    definition?: Definition;
    existing?: boolean;
    published?: boolean;
  } | undefined;
  if (!container || !config) return;
  createRoot(container).render(<PreliminaryEditor
    initial={config.definition || { title: '', content: '', sections: [] }}
    existing={Boolean(config.existing)}
    wasPublished={Boolean(config.published)}
  />);
});

export default page;
