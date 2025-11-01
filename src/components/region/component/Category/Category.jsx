import React, {useState,useEffect,useRef} from 'react'

// Page css
import './Category.style.css'

const Category = ({selected, setSelected}) => {
  const [fixed, setFixed] = useState(false);
  const categoryRef = useRef(null);

  // 전체를 초기값으로
  // const [selected, setSelected] = useState('전체');
  const region = ["전체", "서울", "경기도", "강원도", "충청도", "경상도", "전라도", "제주도"];

  useEffect(() => {
    const handleScroll = () => {
      if (!categoryRef.current) return;

      // 헤더 높이 기준으로 스크롤 체크 (51px)
      const headerHeight = 51;
      if (window.scrollY >= headerHeight) {
        setFixed(true);
      } else {
        setFixed(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
    }, []);

  return (
    <>
        <div ref={categoryRef} className={`categoryCover ${fixed ? 'fixed' : ''}`}>
            <ul className="categoryUl">
              {region.map((reg)=>(
                <li
                  key={reg}
                  className={`categoryLi ${selected === reg ? 'active':''}`}
                  onClick={()=>setSelected(reg)}
                >
                  {reg}
                </li>
              ))}
            </ul>
        </div>
        <div className="emptyLine1px"></div>
    </>
  )
}

export default Category
