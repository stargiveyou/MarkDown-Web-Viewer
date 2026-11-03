import { describe, expect, it } from 'vitest';

import { isPdfSubpath, pdfViewerHref, viewerHref, viewerHrefFor } from './viewer-nav';

describe('isPdfSubpath', () => {
  it('판정은 확장자 기준이며 대소문자를 가리지 않는다', () => {
    expect(isPdfSubpath('보고서.pdf')).toBe(true);
    expect(isPdfSubpath('a/b/REPORT.PDF')).toBe(true);
  });

  it('PDF가 아닌 경로는 false', () => {
    expect(isPdfSubpath('note.md')).toBe(false);
    expect(isPdfSubpath('photo.png')).toBe(false);
    expect(isPdfSubpath('report.pdf.md')).toBe(false);
  });

  it('쿼리·프래그먼트가 붙은 URL도 판정한다', () => {
    expect(isPdfSubpath('/api/pdf?path=a.pdf')).toBe(false);
    expect(isPdfSubpath('a.pdf?v=2')).toBe(true);
    expect(isPdfSubpath('a.pdf#page=3')).toBe(true);
  });
});

describe('viewerHrefFor', () => {
  it('마크다운은 마크다운 뷰어로 보낸다', () => {
    expect(viewerHrefFor('폴더/문서.md')).toBe(viewerHref('폴더/문서.md'));
    expect(viewerHrefFor('note.markdown')).toBe(viewerHref('note.markdown'));
  });

  it('PDF는 PDF 뷰어로 보낸다', () => {
    expect(viewerHrefFor('폴더/보고서.pdf')).toBe(pdfViewerHref('폴더/보고서.pdf'));
    expect(viewerHrefFor('폴더/보고서.pdf')).toBe(
      '/workspace/pdf?path=%ED%8F%B4%EB%8D%94%2F%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf',
    );
  });

  it('뷰어가 없는 종류는 null — 호출부가 폴백을 고른다', () => {
    expect(viewerHrefFor('photo.png')).toBeNull();
    expect(viewerHrefFor('archive.zip')).toBeNull();
  });

  it('경로 구분자를 인코딩해 쿼리 경계를 넘기지 않는다', () => {
    expect(pdfViewerHref('a b/c&d.pdf')).toBe('/workspace/pdf?path=a%20b%2Fc%26d.pdf');
  });
});
