/** Shared text fixtures (Korean thesis cover + English article) reused across tests. */

export const THESIS_KO = `관리지역 세분화에 관한 연구

지도교수  정주철

이 논문을 도시계획학 석사학위 논문으로 제출함

2020년 2월

심사위원장  김영호  (인)
심사위원    박민수  (인)
심사위원    정주철  (인)
학과장      이정민
`;

export const EMPTY_THESIS = `관리지역 세분화에 관한 연구

이 논문을 도시계획학 석사학위 논문으로 제출함

2020년 2월
`;

export const ARTICLE_EN = `Impact of urban green space on social capital

Seonju Jang, Galen Newman, Chanam Lee

Department of Landscape Architecture, Texas A&M University
sjang@tamu.edu

Abstract
This study examines how urban green space affects social capital in cities.

1. Introduction
Social capital theory has a long history.

References
1. Smith, J. and Brown, K. (2019). Urban form. Journal of Planning.
2. Park, M. and Choi, H. (2018). Density patterns. Cities.
`;

/** A minimal one-page PDF with a real text layer (parsed via pdfjs xref recovery). */
export const MINI_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 70>>stream
BT /F1 18 Tf 72 700 Td (Advisor: Galen D. Newman) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;
