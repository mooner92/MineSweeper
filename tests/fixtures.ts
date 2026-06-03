/** Shared text fixtures (Korean thesis cover + English article) reused across tests. */

export const THESIS_KO = `도시 공원 이용에 관한 연구

지도교수  이준호

이 논문을 도시계획학 석사학위 논문으로 제출함

2020년 2월

심사위원장  박서준  (인)
심사위원    최지훈  (인)
심사위원    이준호  (인)
학과장      윤도현
`;

export const EMPTY_THESIS = `도시 공원 이용에 관한 연구

이 논문을 도시계획학 석사학위 논문으로 제출함

2020년 2월
`;

export const ARTICLE_EN = `A study of urban green space and community

Gildong Hong, John Carter, Mark Lee

Department of Landscape Architecture, Example University
ghong@example.edu

Abstract
This study examines how urban green space affects community space in cities.

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
BT /F1 18 Tf 72 700 Td (Advisor: John D. Carter) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;
