import React, {useEffect, useState} from 'react'

// Components
import HomeIcon from '../../../functionComponents/HomeIcon'

// Page css
import './MainImage.style.css'

const MainImage = ({item}) => {

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);
      
  // 화면 크기 변경 시 모바일 여부 감지
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 480);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  return (
    <div>
      <div className='mainImageCover'>
        {isMobile && <HomeIcon />}
        <img src={item.imgName+"2.jpg"} alt={item.imgName+"2.jpg"} />
        <h2 className="locationName">{item.location}</h2>
        <p className="locationSlogan">{item.imgText}</p>
        {item.review?
            <a href={item.reviewAddress} target="_blank" rel="noopener noreferrer">
              <span className='review'>찐리뷰</span>
            </a>
          : <div></div>
        }
      </div>
      <div className="emptyLine"></div>
    </div>
  )
}

export default MainImage
